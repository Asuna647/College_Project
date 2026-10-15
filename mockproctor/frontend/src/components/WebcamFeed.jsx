import { useEffect, useRef, useState } from "react";
import { initFaceDetector, detectFaces } from "../lib/faceDetector.js";
import { initFaceLandmarker, detectLandmarks } from "../lib/faceLandmarker.js";
import { initBrowserSignals } from "../lib/browserSignals.js";
import { EventDebouncer } from "../lib/eventDebouncer.js";
import { isValidFaceBoundingBox, calculateCombinedConfidence } from "../lib/faceValidator.js";
import { FaceTracker } from "../lib/faceTracker.js";
import {
  calculateHeadPoseAdvanced,
  ScreenGazeCalibrator,
  ScreenGazeEventDetector,
} from "../lib/advancedGazeDetection.js";
import "../cameraOverlayFix.css";

const NO_FACE_MS = 1400;
const MULTI_FACE_MS = 500;
const INFERENCE_INTERVAL_MS = 80;

// Gaze events require a personalized 9-point viewport calibration and a sustained,
// high-confidence prediction beyond the calibrated screen boundary.
const OUTSIDE_SCREEN_SUSTAINED_SECONDS = 1.8;

export default function WebcamFeed({
  active,
  onSignalChange,
  onGazeChange,
  onTabChange,
  onEvent,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const activeRef = useRef(active);
  const callbacksRef = useRef({ onSignalChange, onGazeChange, onTabChange, onEvent });
  const trackerRef = useRef(new FaceTracker(4));
  const debouncerRef = useRef(new EventDebouncer(5000));
  const screenCalibratorRef = useRef(new ScreenGazeCalibrator());
  const screenGazeDetectorRef = useRef(new ScreenGazeEventDetector({ sustainedSeconds: OUTSIDE_SCREEN_SUSTAINED_SECONDS }));
  const calibratedRef = useRef(false);
  const lastFrameAtRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const faceStateRef = useRef("unknown");
  const gazeStateRef = useRef("ok");
  const noFaceSinceRef = useRef(null);
  const multiFaceSinceRef = useRef(null);
  const lastFaceErrorRef = useRef("");
  const lastGazeErrorRef = useRef("");

  const [cameraStatus, setCameraStatus] = useState("Starting camera…");
  const [faceModelStatus, setFaceModelStatus] = useState("Loading");
  const [landmarkModelStatus, setLandmarkModelStatus] = useState("Loading");
  const [faceError, setFaceError] = useState("");
  const [gazeError, setGazeError] = useState("");
  const [faceCount, setFaceCount] = useState(0);
  const [landmarkCount, setLandmarkCount] = useState(0);
  const [gazePose, setGazePose] = useState({ yaw: 0, pitch: 0, roll: 0, gazeOffset: 0, confidence: 0 });
  const [gazePrediction, setGazePrediction] = useState(null);
  const [calibration, setCalibration] = useState({ phase: "idle", progress: 0, targetIndex: 0, targetCount: 9, target: null });
  const calibrationStatusRef = useRef({ phase: "idle", progress: 0, targetIndex: 0, targetCount: 9, target: null });
  const [elapsed, setElapsed] = useState(0);

  activeRef.current = active;
  callbacksRef.current = { onSignalChange, onGazeChange, onTabChange, onEvent };

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let rafId = null;
    let timerId = null;
    let browserSignals = null;
    const startedAt = Date.now();
    let faceDetectorReady = false;
    let landmarkerReady = false;

    timerId = window.setInterval(() => {
      if (activeRef.current) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    // Load models independently: a gaze-model failure cannot disable face detection.
    initFaceDetector().then(() => {
      if (cancelled) return;
      faceDetectorReady = true;
      setFaceModelStatus("Ready");
      setFaceError("");
      lastFaceErrorRef.current = "";
    }).catch((error) => {
      if (cancelled) return;
      const message = readableError(error);
      setFaceModelStatus("Failed");
      setFaceError(message);
      lastFaceErrorRef.current = message;
      console.error("Face detector initialization failed:", error);
    });

    initFaceLandmarker().then(() => {
      if (cancelled) return;
      landmarkerReady = true;
      setLandmarkModelStatus("Ready");
      setGazeError("");
      lastGazeErrorRef.current = "";
    }).catch((error) => {
      if (cancelled) return;
      const message = readableError(error);
      setLandmarkModelStatus("Failed");
      setGazeError(message);
      lastGazeErrorRef.current = message;
      console.error("Face landmarker initialization failed:", error);
    });

    async function startCamera() {
      try {
        setCameraStatus("Requesting camera permission…");
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API unavailable. Use localhost or HTTPS in a modern browser.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) throw new Error("Webcam video element is not available.");
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraStatus("Camera running");
        browserSignals = initBrowserSignals((signal) => {
          if (!activeRef.current) return;
          const callbacks = callbacksRef.current;
          if (debouncerRef.current.shouldEmit(signal.type)) {
            if (signal.type === "tab_switch") callbacks.onTabChange?.("tab_switch");
            if (signal.type === "window_blur") callbacks.onTabChange?.("window_blur");
            callbacks.onEvent?.(signal.type);
            window.setTimeout(() => callbacksRef.current.onTabChange?.("ok"), 1000);
          }
        });
      } catch (error) {
        const message = readableError(error);
        setCameraStatus(`Camera error: ${message}`);
        console.error("Webcam startup failed:", error);
      }
    }

    function processFrame() {
      if (cancelled) return;
      rafId = window.requestAnimationFrame(processFrame);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

      // The bitmap canvas must have exactly the camera frame's aspect ratio.
      // Resizing only when needed avoids resetting the drawing context each frame.
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const now = performance.now();
      if (now - lastFrameAtRef.current < INFERENCE_INTERVAL_MS) return;
      lastFrameAtRef.current = now;
      const timestamp = Math.max(now, lastTimestampRef.current + 1);
      lastTimestampRef.current = timestamp;

      if (faceDetectorReady) {
        try {
          const result = detectFaces(video, timestamp);
          const raw = Array.isArray(result?.detections) ? result.detections : [];
          const valid = raw.filter((detection) => {
            const confidence = calculateCombinedConfidence(detection);
            return isValidFaceBoundingBox(
              detection?.boundingBox, video.videoWidth, video.videoHeight, confidence,
            );
          });
          const tracked = trackerRef.current.update(valid);
          setFaceCount((previous) => previous === tracked.length ? previous : tracked.length);
          drawBoxes(canvas, tracked, video.videoWidth, video.videoHeight);
          setFaceError("");
          lastFaceErrorRef.current = "";
          updateFaceState(tracked.length, Date.now());
        } catch (error) {
          const message = readableError(error);
          drawBoxes(canvas, [], video.videoWidth, video.videoHeight);
          setFaceError(message);
          if (lastFaceErrorRef.current !== message) {
            console.error("Face detection failed:", error);
            lastFaceErrorRef.current = message;
          }
        }
      } else {
        drawBoxes(canvas, [], video.videoWidth, video.videoHeight);
      }

      if (landmarkerReady) {
        try {
          const result = detectLandmarks(video, timestamp);
          const faces = Array.isArray(result?.faceLandmarks) ? result.faceLandmarks : [];
          setLandmarkCount((previous) => previous === faces.length ? previous : faces.length);
          setGazeError("");
          lastGazeErrorRef.current = "";

          if (faces.length > 0) {
            const pose = calculateHeadPoseAdvanced(faces[0]);
            setGazePose(pose);
            const calibrationStatus = screenCalibratorRef.current.addSample(pose);
            const previousCalibration = calibrationStatusRef.current;
            if (calibrationStatus.phase !== previousCalibration.phase ||
                calibrationStatus.targetIndex !== previousCalibration.targetIndex ||
                calibrationStatus.error !== previousCalibration.error) {
              calibrationStatusRef.current = calibrationStatus;
              setCalibration(calibrationStatus);
            }
            if (calibrationStatus.phase === "ready") calibratedRef.current = true;

            const prediction = calibratedRef.current ? screenCalibratorRef.current.predict(pose) : null;
            setGazePrediction(prediction);
            if (activeRef.current && calibratedRef.current) {
              const gazeEvent = screenGazeDetectorRef.current.evaluate(prediction);
              updateGazeState(gazeEvent ? "looking_away" : "ok");
              if (gazeEvent && debouncerRef.current.shouldEmit("looking_away")) {
                callbacksRef.current.onEvent?.("looking_away");
              }
            } else {
              screenGazeDetectorRef.current.reset();
              updateGazeState("ok");
            }
          } else {
            setGazePose({ yaw: 0, pitch: 0, roll: 0, gazeOffset: 0, confidence: 0 });
            setLandmarkCount(0);
            screenGazeDetectorRef.current.reset();
            setGazePrediction(null);
            if (activeRef.current) updateGazeState("ok");
          }
        } catch (error) {
          const message = readableError(error);
          setGazeError(message);
          if (lastGazeErrorRef.current !== message) {
            console.error("Landmark/gaze processing failed:", error);
            lastGazeErrorRef.current = message;
          }
        }
      }
    }

    function updateFaceState(count, now) {
      let nextState = faceStateRef.current;
      if (count === 0) {
        multiFaceSinceRef.current = null;
        if (noFaceSinceRef.current === null) noFaceSinceRef.current = now;
        if (now - noFaceSinceRef.current >= NO_FACE_MS) nextState = "no_face";
      } else if (count > 1) {
        noFaceSinceRef.current = null;
        if (multiFaceSinceRef.current === null) multiFaceSinceRef.current = now;
        if (now - multiFaceSinceRef.current >= MULTI_FACE_MS) nextState = "multi_face";
      } else {
        noFaceSinceRef.current = null;
        multiFaceSinceRef.current = null;
        nextState = "ok";
      }

      if (nextState !== faceStateRef.current) {
        faceStateRef.current = nextState;
        callbacksRef.current.onSignalChange?.(nextState);
        if (activeRef.current && (nextState === "no_face" || nextState === "multi_face")) {
          callbacksRef.current.onEvent?.(nextState);
        }
      }
    }

    function updateGazeState(nextState) {
      if (nextState === gazeStateRef.current) return;
      gazeStateRef.current = nextState;
      callbacksRef.current.onGazeChange?.(nextState);
    }

    startCamera();
    rafId = window.requestAnimationFrame(processFrame);

    return () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (timerId !== null) window.clearInterval(timerId);
      if (browserSignals) browserSignals.cleanup();
      if (stream) stream.getTracks().forEach((track) => track.stop());
      trackerRef.current.reset();
      screenGazeDetectorRef.current.reset();
    };
  }, []);

  function startScreenCalibration() {
    screenCalibratorRef.current.start();
    screenGazeDetectorRef.current.reset();
    calibratedRef.current = false;
    setGazePrediction(null);
    const status = screenCalibratorRef.current.status();
    calibrationStatusRef.current = status;
    setCalibration(status);
    updateGazeState("ok");
  }

  function updateGazeState(nextState) {
    if (nextState === gazeStateRef.current) return;
    gazeStateRef.current = nextState;
    callbacksRef.current.onGazeChange?.(nextState);
  }

  return (
    <div className="video-panel">
      <video ref={videoRef} muted playsInline autoPlay />
      <canvas ref={canvasRef} width={640} height={480} />
      <div className="reticle tl" />
      <div className="reticle tr" />
      <div className="reticle bl" />
      <div className="reticle br" />
      <div className="rec-overlay">
        <span className={`dot ${active ? "rec" : ""}`} />
        {active ? `REC ${formatTime(elapsed)}` : "STANDBY (PREVIEW ACTIVE)"}
      </div>
      <div className="timestamp-overlay">{cameraStatus.toUpperCase()}</div>
      <div style={{
        position: "absolute", right: 10, bottom: 76, zIndex: 12,
        width: "min(360px, 72%)", maxHeight: "48%", overflowY: "auto",
        overflowWrap: "anywhere", padding: 10, borderRadius: 6,
        border: "1px solid #4dd0e1", background: "rgba(0,0,0,.92)",
        color: "#4dd0e1", font: "11px/1.5 monospace",
      }}>
        <div style={{ color: "#93c5fd", fontWeight: 700 }}>LIVE DIAGNOSTICS</div>
        <div>FACE MODEL: {faceModelStatus} | FACES: {faceCount}</div>
        <div>LANDMARK MODEL: {landmarkModelStatus} | LANDMARK FACES: {landmarkCount}</div>
        <div>GAZE RULE: screen boundary ±4% + {OUTSIDE_SCREEN_SUSTAINED_SECONDS}s sustained high confidence</div>
        <div>GAZE PREDICTION: {gazePrediction ? `x=${gazePrediction.x.toFixed(2)} y=${gazePrediction.y.toFixed(2)} conf=${gazePrediction.confidence.toFixed(2)}` : "waiting for calibration / confident eyes"}</div>
        <div>SCREEN CALIBRATION: {calibration.phase.toUpperCase()} ({calibration.targetIndex || 0}/{calibration.targetCount || 9})</div>
        {calibration.rms !== null && calibration.rms !== undefined && <div>CALIBRATION ERROR: {calibration.rms.toFixed(3)}</div>}
        <div>YAW: {Number(gazePose.yaw || 0).toFixed(1)}° | PITCH PROXY: {Number(gazePose.pitch || 0).toFixed(1)}</div>
        <div>ROLL: {Number(gazePose.roll || 0).toFixed(1)}° | H EYE: {Number(gazePose.gazeOffset || 0).toFixed(1)} | V EYE: {Number(gazePose.gazeVerticalOffset || 0).toFixed(1)}</div>
        {faceError && <div style={{ color: "#fda4af", marginTop: 4 }}>FACE ERROR: {faceError}</div>}
        {gazeError && <div style={{ color: "#fcd34d", marginTop: 4 }}>GAZE ERROR: {gazeError}</div>}
      </div>
      {calibration.phase !== "ready" && (
        <div className={`screen-calibration-overlay ${calibration.phase === "collecting" ? "is-collecting" : ""}`}>
          {calibration.phase === "collecting" && calibration.target && (
            <div className="calibration-target" style={{ left: `${calibration.target.x * 100}%`, top: `${calibration.target.y * 100}%` }}>
              <span />
            </div>
          )}
          <div className="calibration-panel">
            <strong>{calibration.phase === "collecting" ? `Follow the dot · ${Math.min(calibration.targetIndex + 1, 9)} of 9` : "Personalize gaze calibration"}</strong>
            <p>{calibration.phase === "collecting"
              ? "Keep your head reasonably still and follow the dot with your eyes. Each point samples your own eye/head movement."
              : calibration.phase === "failed"
                ? (calibration.error || "Calibration failed. Please try again.")
                : "A short 9-point calibration maps your gaze to this screen. Gaze alerts stay off until calibration succeeds. Face-presence alerts remain independent."}</p>
            {calibration.phase === "collecting" ? (
              <div className="calibration-progress"><span style={{ width: `${(calibration.targetIndex / 9) * 100}%` }} /></div>
            ) : (
              <button type="button" onClick={startScreenCalibration}>Start 9-point calibration</button>
            )}
            {calibration.error && calibration.phase === "collecting" && <small>{calibration.error}</small>}
          </div>
        </div>
      )}
      {calibration.phase === "ready" && (
        <button type="button" className="recalibrate-button" onClick={startScreenCalibration}>Recalibrate gaze</button>
      )}
    </div>
  );
}

function readableError(error) {
  if (error instanceof Error && error.message) return error.message;
  try { return String(error); } catch { return "Unknown error"; }
}

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function drawBoxes(canvas, detections, videoWidth, videoHeight) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!videoWidth || !videoHeight) return;

  // Canvas backing dimensions match the video source (set in processFrame).
  // The video is mirrored by CSS; mirror X here only, not the entire canvas.
  const scaleX = canvas.width / videoWidth;
  const scaleY = canvas.height / videoHeight;
  ctx.strokeStyle = "#4dd0e1";
  ctx.lineWidth = Math.max(2, canvas.width / 320);
  for (const detection of detections) {
    const box = detection?.boundingBox;
    if (!box) continue;

    // MediaPipe boxes are normally pixel-space; tolerate normalized boxes too.
    let bx = box.originX;
    let by = box.originY;
    let bw = box.width;
    let bh = box.height;
    if (Math.max(Math.abs(bx), Math.abs(by), Math.abs(bw), Math.abs(bh)) <= 1.5) {
      bx *= videoWidth; by *= videoHeight; bw *= videoWidth; bh *= videoHeight;
    }

    const x = canvas.width - (bx + bw) * scaleX;
    const y = by * scaleY;
    const width = bw * scaleX;
    const height = bh * scaleY;
    ctx.strokeRect(x, y, width, height);
  }
}
