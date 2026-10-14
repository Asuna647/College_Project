import { useEffect, useRef, useState } from "react";
import { initFaceDetector, detectFaces } from "../lib/faceDetector.js";
import {
  initFaceLandmarker,
  detectLandmarks,
  calculateHeadYaw,
  smoothYaw
} from "../lib/faceLandmarker.js";
import { initBrowserSignals } from "../lib/browserSignals.js";
import { EventDebouncer } from "../lib/eventDebouncer.js";
import { isValidFaceBoundingBox, calculateCombinedConfidence } from "../lib/faceValidator.js";
import { FaceTracker } from "../lib/faceTracker.js";
import { calculateHeadPoseAdvanced, GazeEventDetector, AdaptiveGazeDetector } from "../lib/advancedGazeDetection.js";

// Tuned for a ~30fps loop.
const NO_FACE_THRESHOLD_FRAMES = 45; // ~1.5s
const MULTI_FACE_THRESHOLD_FRAMES = 10; // ~0.3s

// Advanced Detection: Feature flags
const USE_FACE_VALIDATOR = false;
const USE_FACE_TRACKER = false;
const USE_ADVANCED_GAZE = true;
const USE_ADAPTIVE_CALIBRATION = true;

export default function WebcamFeed({ active, onSignalChange, onGazeChange, onTabChange, onEvent }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const noFaceCount = useRef(0);
  const multiFaceCount = useRef(0);
  const currentState = useRef("unknown");

  // Gaze state
  const yawSmoothed = useRef(0);
  const currentGazeState = useRef("ok");

  // Browser signals & debouncer
  const browserSignalsRef = useRef(null);
  const debouncerRef = useRef(new EventDebouncer(5000));

  const faceTrackerRef = useRef(USE_FACE_TRACKER ? new FaceTracker(5) : null);
  const gazeDetectorRef = useRef(USE_ADVANCED_GAZE ? new GazeEventDetector(18, 1.2, 0.35) : null);
  const adaptiveGazeRef = useRef(USE_ADAPTIVE_CALIBRATION ? new AdaptiveGazeDetector() : null);

  const [calibrationStatus, setCalibrationStatus] = useState(null);
  const [debugAdvancedGaze, setDebugAdvancedGaze] = useState({ yaw: 0, pitch: 0, roll: 0, confidence: 0 });

  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("loading models");
  const [debugYaw, setDebugYaw] = useState(0);
  const [tabState, setTabState] = useState("ok");

  // Single robust effect handling camera init and the 30fps detection loop continuously
  useEffect(() => {
    let stream;
    let cancelled = false;
    let lastTs = 0;
    const startTime = Date.now();

    const timerId = setInterval(() => {
      if (active) {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }
    }, 1000);

    async function initCameraAndLoop() {
      try {
        setStatus("loading models");
        await Promise.all([initFaceDetector(), initFaceLandmarker()]);
        if (cancelled) return;

        setStatus("requesting camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Initialize browser signals regardless of session state, but gate logging inside handler
        browserSignalsRef.current = initBrowserSignals((signal) => {
          if (active) {
            handleBrowserSignal(signal);
          }
        });

        setStatus("ready");
        loop();
      } catch (err) {
        console.error("Camera/Model init error:", err);
        setStatus("camera error");
      }
    }

    function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState >= 2) {
        setStatus(active ? "live" : "ready (preview)");

        // Ensure monotonically increasing timestamp for MediaPipe video processing
        let ts = performance.now();
        if (ts <= lastTs) {
          ts = lastTs + 1;
        }
        lastTs = ts;

        try {
          // 1. Always run face detection and draw bounding boxes (even before session starts!)
          const faceResult = detectFaces(video, ts);
          let displayDetections = faceResult.detections || [];
          drawBoxes(canvas, displayDetections, video.videoWidth, video.videoHeight);

          // 2. Always run landmark detection & head pose estimation so debug UI updates and you know it works
          const landmarkResult = detectLandmarks(video, ts);
          if (landmarkResult.faceLandmarks && landmarkResult.faceLandmarks.length > 0) {
            const landmarks = landmarkResult.faceLandmarks[0];

            if (USE_ADVANCED_GAZE) {
              const headPose = calculateHeadPoseAdvanced(landmarks);
              setDebugAdvancedGaze(headPose);

              if (USE_ADAPTIVE_CALIBRATION && adaptiveGazeRef.current) {
                const calibStatus = adaptiveGazeRef.current.feedSample(headPose);
                setCalibrationStatus(calibStatus);
              }

              if (gazeDetectorRef.current) {
                const gazeEvent = gazeDetectorRef.current.evaluate(headPose);
                // Only evaluate/log signals if active
                if (active) {
                  if (gazeEvent) {
                    evaluateAdvancedGazeSignal(gazeEvent);
                  } else {
                    evaluateAdvancedGazeSignal(null);
                  }
                }
              }
            }
          }

          // 3. Only evaluate face signals & trigger violations when active is true
          if (active) {
            evaluateFaceSignal(displayDetections.length);
          }
        } catch (detectErr) {
          // Prevent frame loop crash if MediaPipe throws a timing/sync exception
          console.debug("Detection frame skip:", detectErr);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    initCameraAndLoop();

    return () => {
      cancelled = true;
      clearInterval(timerId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (browserSignalsRef.current) {
        browserSignalsRef.current.cleanup();
        browserSignalsRef.current = null;
      }
    };
  }, [active]);

  function evaluateFaceSignal(faceCount) {
    if (!active) return;
    if (faceCount === 0) {
      noFaceCount.current += 1;
      multiFaceCount.current = 0;
    } else if (faceCount > 1) {
      multiFaceCount.current += 1;
      noFaceCount.current = 0;
    } else {
      noFaceCount.current = 0;
      multiFaceCount.current = 0;
    }

    let nextState = "ok";
    if (noFaceCount.current >= NO_FACE_THRESHOLD_FRAMES) nextState = "no_face";
    if (multiFaceCount.current >= MULTI_FACE_THRESHOLD_FRAMES) nextState = "multi_face";

    if (nextState !== currentState.current) {
      currentState.current = nextState;
      onSignalChange?.(nextState);
      if (nextState !== "ok") onEvent?.(nextState);
    }
  }

  function evaluateAdvancedGazeSignal(gazeEvent) {
    if (!active) return;
    if (gazeEvent && gazeEvent.type === "looking_away") {
      if (currentGazeState.current !== "looking_away") {
        currentGazeState.current = "looking_away";
        onGazeChange?.("looking_away");
      }
      if (debouncerRef.current.shouldEmit("looking_away")) {
        onEvent?.("looking_away");
      }
    } else {
      if (currentGazeState.current !== "ok") {
        currentGazeState.current = "ok";
        onGazeChange?.("ok");
      }
    }
  }

  function handleBrowserSignal(signal) {
    if (!active) return;
    if (debouncerRef.current.shouldEmit(signal.type)) {
      if (signal.type === "tab_switch") {
        setTabState("tab_switch");
        onTabChange?.("tab_switch");
        setTimeout(() => {
          setTabState("ok");
          onTabChange?.("ok");
        }, 1000);
      } else if (signal.type === "window_blur") {
        setTabState("window_blur");
        onTabChange?.("window_blur");
        setTimeout(() => {
          setTabState("ok");
          onTabChange?.("ok");
        }, 1000);
      }
      onEvent?.(signal.type);
    }
  }

  return (
    <div className="video-panel">
      <video ref={videoRef} muted playsInline />
      <canvas ref={canvasRef} width={640} height={480} />
      <div className="reticle tl" />
      <div className="reticle tr" />
      <div className="reticle bl" />
      <div className="reticle br" />
      <div className="rec-overlay">
        <span className={`dot ${active ? "rec" : ""}`} />
        {active ? `REC ${formatTime(elapsed)}` : "STANDBY (PREVIEW ACTIVE)"}
      </div>
      <div className="timestamp-overlay">{status.toUpperCase()}</div>

      {/* Debug readout: Always active so you can see face tracking & gaze stats before starting session */}
      <div className="debug-readout" style={{
        position: "absolute",
        bottom: 80,
        right: 10,
        background: "rgba(0, 0, 0, 0.9)",
        color: "#4dd0e1",
        padding: "12px",
        borderRadius: "6px",
        fontFamily: "monospace",
        fontSize: "11px",
        zIndex: 10,
        lineHeight: 1.4,
        maxWidth: "280px",
        border: "1px solid #4dd0e1",
      }}>
        {USE_ADVANCED_GAZE ? (
          <>
            <div style={{ color: "#60a5fa" }}>ADVANCED GAZE:</div>
            <div>YAW: {debugAdvancedGaze.yaw.toFixed(1)}° | PITCH: {debugAdvancedGaze.pitch.toFixed(1)}°</div>
            <div>ROLL: {debugAdvancedGaze.roll.toFixed(1)}° | CONF: {(debugAdvancedGaze.confidence * 100).toFixed(0)}%</div>
            {calibrationStatus && (
              <div style={{ color: "#fbbf24", marginTop: "4px" }}>
                CAL: {calibrationStatus.phase === 'calibrating'
                  ? `${(calibrationStatus.progress * 100).toFixed(0)}%`
                  : 'ready'}
              </div>
            )}
          </>
        ) : (
          <div>YAW: {debugYaw}°</div>
        )}
      </div>
    </div>
  );
}

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function drawBoxes(canvas, detections, videoWidth, videoHeight) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!videoWidth || !videoHeight) return;

  const scaleX = canvas.width / videoWidth;
  const scaleY = canvas.height / videoHeight;

  ctx.strokeStyle = "#4dd0e1";
  ctx.lineWidth = 2;
  detections.forEach((detection) => {
    const box = detection.boundingBox;
    ctx.strokeRect(
      box.originX * scaleX,
      box.originY * scaleY,
      box.width * scaleX,
      box.height * scaleY
    );
  });
}
