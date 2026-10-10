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

// Tuned for a ~30fps loop. Raise these if you get false positives from
// brief detection glitches; lower them if anomalies feel slow to register.
const NO_FACE_THRESHOLD_FRAMES = 45; // ~1.5s
const MULTI_FACE_THRESHOLD_FRAMES = 10; // ~0.3s — deliberately fast, this one matters more

// Phase 2: Gaze detection thresholds
const LOOKING_AWAY_THRESHOLD_DEGREES = 25; // ±25° = looking away
const LOOKING_AWAY_DURATION_SECONDS = 5;   // Must sustain for 5s to trigger

// Advanced Detection: Feature flags
const USE_FACE_VALIDATOR = true;     // Phase 4B: Enable bounding box validation
const USE_FACE_TRACKER = true;        // Phase 4B: Enable temporal tracking
const USE_ADVANCED_GAZE = true;       // Phase 4C: Enable advanced head pose
const USE_ADAPTIVE_CALIBRATION = true; // Phase 4C: Enable adaptive threshold

export default function WebcamFeed({ active, onSignalChange, onGazeChange, onTabChange, onEvent }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const noFaceCount = useRef(0);
  const multiFaceCount = useRef(0);
  const currentState = useRef("unknown");

  // Phase 2: Gaze state
  const yawSmoothed = useRef(0);
  const lookingAwayStartTime = useRef(null);
  const lookingAwayFired = useRef(false);
  const currentGazeState = useRef("ok");

  // Phase 3: Browser signals
  const browserSignalsRef = useRef(null);

  // Phase 4: Event debouncing
  const debouncerRef = useRef(new EventDebouncer(5000)); // 5s deduplication window

  // Advanced Detection: Phase 4B - Face Validation & Tracking
  const faceTrackerRef = useRef(USE_FACE_TRACKER ? new FaceTracker(5) : null);

  // Advanced Detection: Phase 4C - Advanced Gaze Detection
  const gazeDetectorRef = useRef(USE_ADVANCED_GAZE ? new GazeEventDetector(25, 5, 0.7) : null);
  const adaptiveGazeRef = useRef(USE_ADAPTIVE_CALIBRATION ? new AdaptiveGazeDetector() : null);
  const [calibrationStatus, setCalibrationStatus] = useState(null);
  const [debugAdvancedGaze, setDebugAdvancedGaze] = useState({ yaw: 0, pitch: 0, roll: 0, confidence: 0 });

  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("standby");
  const [debugYaw, setDebugYaw] = useState(0);
  const [tabState, setTabState] = useState("ok"); // Phase 3: TAB FOCUS state
  const [testMetrics, setTestMetrics] = useState({
    totalFrames: 0,
    validDetections: 0,
    filteredDetections: 0,
    faceAccuracy: 0,
    gazeAccuracy: 0,
  });

  useEffect(() => {
    if (!active) {
      setStatus("standby");
      // Cleanup browser signals on inactive
      if (browserSignalsRef.current) {
        browserSignalsRef.current.cleanup();
        browserSignalsRef.current = null;
      }
      // Reset debouncer
      debouncerRef.current.reset();
      return;
    }

    let stream;
    let cancelled = false;
    const startTime = Date.now();
    const timerId = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    async function start() {
      setStatus("loading model");
      await initFaceDetector();
      await initFaceLandmarker();
      if (cancelled) return;

      // Phase 3: Initialize browser signals
      browserSignalsRef.current = initBrowserSignals((signal) => {
        // Handle browser signal events with debouncing
        handleBrowserSignal(signal);
      });

      setStatus("requesting camera");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      if (cancelled) return;

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus("live");
      loop();
    }

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const ts = performance.now();
      testMetrics.totalFrames += 1;

      // Phase 1: Face detection with Advanced Validation (Phase 4B)
      const faceResult = detectFaces(video, ts);
      let displayDetections = faceResult.detections;

      if (USE_FACE_VALIDATOR) {
        // Validate bounding boxes
        displayDetections = faceResult.detections.filter(detection =>
          isValidFaceBoundingBox(detection, video.videoWidth, video.videoHeight)
        );
        testMetrics.validDetections += displayDetections.length;
        testMetrics.filteredDetections += (faceResult.detections.length - displayDetections.length);
      }

      // Phase 4B: Face Tracking for temporal consistency
      let trackedFaces = displayDetections;
      if (USE_FACE_TRACKER && faceTrackerRef.current) {
        const confirmedTracks = faceTrackerRef.current.update(displayDetections);
        trackedFaces = confirmedTracks.map(t => t.detection);
        // Log tracking metrics
        console.log(
          `[FACE TRACKER] Tracks: ${faceTrackerRef.current.getTrackCount()}, Confirmed: ${confirmedTracks.length}`
        );
      }

      drawBoxes(canvas, trackedFaces, video.videoWidth, video.videoHeight);
      evaluateFaceSignal(trackedFaces.length);

      // Phase 2: Gaze detection with Advanced Head Pose (Phase 4C)
      const landmarkResult = detectLandmarks(video, ts);
      if (landmarkResult.faceLandmarks && landmarkResult.faceLandmarks.length > 0) {
        const landmarks = landmarkResult.faceLandmarks[0];

        let headPose;
        if (USE_ADVANCED_GAZE) {
          // Use advanced head pose calculation
          headPose = calculateHeadPoseAdvanced(landmarks);
          setDebugAdvancedGaze(headPose);

          // Feed to adaptive calibration if enabled
          if (USE_ADAPTIVE_CALIBRATION && adaptiveGazeRef.current) {
            const calibStatus = adaptiveGazeRef.current.feedSample(headPose);
            setCalibrationStatus(calibStatus);
          }

          // Use confidence-based gaze detector
          if (gazeDetectorRef.current) {
            const gazeEvent = gazeDetectorRef.current.evaluate(headPose);
            if (gazeEvent) {
              console.log(`[ADVANCED GAZE] Event fired: ${gazeEvent.type}, confidence: ${gazeEvent.confidence.toFixed(2)}, yaw: ${gazeEvent.yaw.toFixed(1)}°`);
              evaluateAdvancedGazeSignal(gazeEvent);
            }
          }
        } else {
          // Fall back to Phase 2 yaw calculation
          const yawRaw = calculateHeadYaw(landmarks);
          yawSmoothed.current = smoothYaw(yawRaw, yawSmoothed.current, 0.3);
          setDebugYaw(Math.round(yawSmoothed.current));
          evaluateGazeSignal(yawSmoothed.current);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    function evaluateFaceSignal(faceCount) {
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

    // Phase 2: Evaluate gaze signal (basic yaw)
    function evaluateGazeSignal(yaw) {
      const isLookingAway = Math.abs(yaw) > LOOKING_AWAY_THRESHOLD_DEGREES;

      if (isLookingAway) {
        if (lookingAwayStartTime.current === null) {
          lookingAwayStartTime.current = Date.now();
          lookingAwayFired.current = false;
        }

        const elapsedSeconds = (Date.now() - lookingAwayStartTime.current) / 1000;
        if (elapsedSeconds >= LOOKING_AWAY_DURATION_SECONDS && !lookingAwayFired.current) {
          lookingAwayFired.current = true;
          // Update gaze state
          if (currentGazeState.current !== "looking_away") {
            currentGazeState.current = "looking_away";
            onGazeChange?.("looking_away");
          }
          if (debouncerRef.current.shouldEmit("looking_away")) {
            onEvent?.("looking_away");
          }
        }
      } else {
        lookingAwayStartTime.current = null;
        lookingAwayFired.current = false;
        // Return to normal gaze
        if (currentGazeState.current !== "ok") {
          currentGazeState.current = "ok";
          onGazeChange?.("ok");
        }
      }
    }

    // Advanced Detection: Phase 4C - Evaluate advanced gaze signal
    function evaluateAdvancedGazeSignal(gazeEvent) {
      if (gazeEvent.type === "looking_away") {
        if (currentGazeState.current !== "looking_away") {
          currentGazeState.current = "looking_away";
          onGazeChange?.("looking_away");
        }
        if (debouncerRef.current.shouldEmit("looking_away")) {
          onEvent?.("looking_away");
        }
      }
    }

    // Phase 3: Handle browser signal events with debouncing
    function handleBrowserSignal(signal) {
      if (debouncerRef.current.shouldEmit(signal.type)) {
        // Update tab state for UI
        if (signal.type === "tab_switch") {
          setTabState("tab_switch");
          onTabChange?.("tab_switch");
          setTimeout(() => {
            setTabState("ok");
            onTabChange?.("ok");
          }, 1000); // Reset after 1s
        } else if (signal.type === "window_blur") {
          setTabState("window_blur");
          onTabChange?.("window_blur");
          setTimeout(() => {
            setTabState("ok");
            onTabChange?.("ok");
          }, 1000); // Reset after 1s
        }
        // Log to backend
        onEvent?.(signal.type);
      }
    }

    start().catch((err) => {
      console.error(err);
      setStatus("camera error");
    });

    return () => {
      cancelled = true;
      clearInterval(timerId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (browserSignalsRef.current) {
        browserSignalsRef.current.cleanup();
        browserSignalsRef.current = null;
      }
      noFaceCount.current = 0;
      multiFaceCount.current = 0;
      currentState.current = "unknown";
      lookingAwayStartTime.current = null;
      debouncerRef.current.reset();
      if (faceTrackerRef.current) faceTrackerRef.current.reset();
      if (gazeDetectorRef.current) gazeDetectorRef.current.reset();
      if (adaptiveGazeRef.current) adaptiveGazeRef.current.reset();

      // Log final test metrics
      console.log("=== SESSION METRICS ===");
      console.log(`Total Frames: ${testMetrics.totalFrames}`);
      console.log(`Valid Detections: ${testMetrics.validDetections}`);
      console.log(`Filtered Detections: ${testMetrics.filteredDetections}`);
      console.log(`False Positive Reduction: ${((testMetrics.filteredDetections / testMetrics.totalFrames) * 100).toFixed(2)}%`);
    };
  }, [active]);

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
        {active ? `REC ${formatTime(elapsed)}` : "STANDBY"}
      </div>
      <div className="timestamp-overlay">{status.toUpperCase()}</div>

      {/* Debug readout: Phase 2 + Advanced Detection metrics */}
      {active && (
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
          {USE_FACE_TRACKER && (
            <div style={{ color: "#10b981", marginTop: "4px" }}>
              TRACKS: {faceTrackerRef.current?.getTrackCount?.() || 0}
            </div>
          )}
        </div>
      )}
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
