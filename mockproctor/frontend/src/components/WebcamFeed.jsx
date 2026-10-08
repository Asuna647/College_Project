import { useEffect, useRef, useState } from "react";
import { initFaceDetector, detectFaces } from "../lib/faceDetector.js";

// Tuned for a ~30fps loop. Raise these if you get false positives from
// brief detection glitches; lower them if anomalies feel slow to register.
const NO_FACE_THRESHOLD_FRAMES = 45; // ~1.5s
const MULTI_FACE_THRESHOLD_FRAMES = 10; // ~0.3s — deliberately fast, this one matters more

export default function WebcamFeed({ active, onSignalChange, onEvent }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const noFaceCount = useRef(0);
  const multiFaceCount = useRef(0);
  const currentState = useRef("unknown");

  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("standby");

  useEffect(() => {
    if (!active) {
      setStatus("standby");
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
      if (cancelled) return;

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
      const result = detectFaces(video, performance.now());
      drawBoxes(canvas, result.detections, video.videoWidth, video.videoHeight);
      evaluateSignal(result.detections.length);
      rafRef.current = requestAnimationFrame(loop);
    }

    function evaluateSignal(faceCount) {
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

    start().catch((err) => {
      console.error(err);
      setStatus("camera error");
    });

    return () => {
      cancelled = true;
      clearInterval(timerId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      noFaceCount.current = 0;
      multiFaceCount.current = 0;
      currentState.current = "unknown";
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
