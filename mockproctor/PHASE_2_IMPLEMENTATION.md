# MockProctor — Phase 2 Implementation Guide: Gaze Detection

## Overview

Phase 2 adds head-pose estimation to detect when students are looking away from the screen for extended periods. This phase teaches:
- MediaPipe Face Landmarker API (facial keypoints)
- Head yaw angle calculation from landmarks
- Temporal signal processing (thresholds + smoothing)
- UI debug readout for tuning

**Estimated time:** 1 week  
**Done when:** Turning head >25° for >5s triggers "looking_away" event, small movements don't false-positive

---

## Architecture Changes

### Frontend: New Module `faceLandmarker.js`

This module wraps MediaPipe's Face Landmarker task (different from Phase 1's FaceDetector). It extracts facial landmarks and calculates head yaw.

```javascript
// frontend/src/lib/faceLandmarker.js

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let landmarker = null;

/**
 * Initialize the Face Landmarker model.
 * Loads from Google CDN, cached by browser after first load.
 */
export async function initFaceLandmarker() {
  if (landmarker) return landmarker;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1, // Only need one face for yaw estimation
  });

  return landmarker;
}

/**
 * Run landmark detection on a video frame.
 * Returns landmarks array with ~478 facial keypoints.
 */
export function detectLandmarks(video, timestampMs) {
  if (!landmarker) {
    throw new Error("Face Landmarker not initialized");
  }
  return landmarker.detectForVideo(video, timestampMs);
}

/**
 * Calculate head yaw (left/right rotation) from facial landmarks.
 *
 * Simplified approach: Use eye corners and nose tip to estimate rotation.
 * Returns yaw in degrees: negative = looking left, positive = looking right.
 *
 * MediaPipe landmark indices (approximate):
 * - Left eye: 33 (outer corner)
 * - Right eye: 263 (outer corner)
 * - Nose tip: 1
 * - Chin: 152
 */
export function calculateHeadYaw(landmarks) {
  if (!landmarks || landmarks.length < 264) {
    return 0; // Not enough landmarks detected
  }

  // Extract key landmark positions
  const noseX = landmarks[1].x;
  const leftEyeX = landmarks[33].x;
  const rightEyeX = landmarks[263].x;
  const eyeCenterX = (leftEyeX + rightEyeX) / 2;

  // Simple heuristic: if nose is offset from eye center, calculate yaw
  // A more robust approach would use 3D pose estimation, but this is sufficient
  const yawRaw = Math.atan2(noseX - eyeCenterX, 0.15) * (180 / Math.PI);

  // Clamp to ±90° range
  return Math.max(-90, Math.min(90, yawRaw));
}

/**
 * Smooth yaw values using exponential moving average.
 * Reduces noise from frame-to-frame jitter.
 *
 * @param {number} newValue - New yaw measurement
 * @param {number} previousSmoothed - Previous smoothed value
 * @param {number} alpha - Smoothing factor (0-1, lower = more smoothing)
 */
export function smoothYaw(newValue, previousSmoothed, alpha = 0.3) {
  return alpha * newValue + (1 - alpha) * previousSmoothed;
}
```

### Frontend: Update `WebcamFeed.jsx`

Integrate Face Landmarker into the detection loop:

```javascript
// frontend/src/components/WebcamFeed.jsx (Phase 2 updates)

import { useEffect, useRef, useState } from "react";
import { initFaceDetector, detectFaces } from "../lib/faceDetector.js";
import { 
  initFaceLandmarker, 
  detectLandmarks, 
  calculateHeadYaw, 
  smoothYaw 
} from "../lib/faceLandmarker.js"; // NEW

// Phase 1 thresholds (unchanged)
const NO_FACE_THRESHOLD_FRAMES = 45;
const MULTI_FACE_THRESHOLD_FRAMES = 10;

// Phase 2 thresholds (NEW)
const LOOKING_AWAY_THRESHOLD_DEGREES = 25; // ±25° = looking away
const LOOKING_AWAY_DURATION_SECONDS = 5;   // Must sustain for 5s to trigger

export default function WebcamFeed({ active, onSignalChange, onEvent }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  
  // Phase 1 state (unchanged)
  const noFaceCount = useRef(0);
  const multiFaceCount = useRef(0);
  const currentState = useRef("unknown");

  // Phase 2 state (NEW)
  const yawSmoothed = useRef(0);
  const lookingAwayStartTime = useRef(null);
  const lookingAwayFired = useRef(false);

  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("standby");
  const [debugYaw, setDebugYaw] = useState(0); // For on-screen display (NEW)

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
      await initFaceLandmarker(); // NEW: Initialize landmarker
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

      const ts = performance.now();
      
      // Phase 1: Face detection
      const faceResult = detectFaces(video, ts);
      drawBoxes(canvas, faceResult.detections, video.videoWidth, video.videoHeight);
      evaluateFaceSignal(faceResult.detections.length);

      // Phase 2: Gaze detection (NEW)
      const landmarkResult = detectLandmarks(video, ts);
      if (landmarkResult.faceLandmarks && landmarkResult.faceLandmarks.length > 0) {
        const landmarks = landmarkResult.faceLandmarks[0];
        const yawRaw = calculateHeadYaw(landmarks);
        yawSmoothed.current = smoothYaw(yawRaw, yawSmoothed.current, 0.3);
        setDebugYaw(Math.round(yawSmoothed.current)); // Update UI debug display
        evaluateGazeSignal(yawSmoothed.current);
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    function evaluateFaceSignal(faceCount) {
      // Phase 1 logic (unchanged)
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

    // NEW: Evaluate gaze signal
    function evaluateGazeSignal(yaw) {
      const isLookingAway = Math.abs(yaw) > LOOKING_AWAY_THRESHOLD_DEGREES;

      if (isLookingAway) {
        // Just started looking away
        if (lookingAwayStartTime.current === null) {
          lookingAwayStartTime.current = Date.now();
          lookingAwayFired.current = false;
        }

        // Check if duration threshold exceeded
        const elapsedSeconds = (Date.now() - lookingAwayStartTime.current) / 1000;
        if (elapsedSeconds >= LOOKING_AWAY_DURATION_SECONDS && !lookingAwayFired.current) {
          lookingAwayFired.current = true;
          onEvent?.("looking_away");
        }
      } else {
        // Returned to normal gaze
        lookingAwayStartTime.current = null;
        lookingAwayFired.current = false;
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
      lookingAwayStartTime.current = null; // Clean up
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
      
      {/* NEW: Debug yaw readout */}
      {active && (
        <div className="debug-readout" style={{
          position: "absolute",
          bottom: 80,
          right: 10,
          background: "rgba(0, 0, 0, 0.8)",
          color: "#4dd0e1",
          padding: "8px 12px",
          borderRadius: "4px",
          fontFamily: "monospace",
          fontSize: "12px",
          zIndex: 10,
        }}>
          YAW: {debugYaw}°
        </div>
      )}
    </div>
  );
}

// ... rest of component (unchanged)
```

### Frontend: Update `SignalLog.jsx`

Activate the GAZE signal status:

```javascript
// frontend/src/components/SignalLog.jsx (Phase 2 updates)

export default function SignalLog({ faceState, events, gazeState }) { // NEW: gazeState param
  const signals = [
    { key: "face", label: "FACE LOCK", tag: "PHASE 1", status: faceDotClass(faceState) },
    { key: "gaze", label: "GAZE", tag: "PHASE 2", status: gazeDotClass(gazeState) }, // UPDATED
    { key: "tab", label: "TAB FOCUS", tag: "PHASE 3", status: "" },
  ];

  return (
    <div className="signal-panel">
      {/* ... rest unchanged ... */}
    </div>
  );
}

function gazeDotClass(state) {
  if (state === "ok") return "ok";
  if (state === "looking_away") return "rec";
  return "";
}
```

### Frontend: Update `App.jsx`

Wire gaze state to SignalLog:

```javascript
// frontend/src/App.jsx (Phase 2 updates)

export default function App() {
  const [backendOk, setBackendOk] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [active, setActive] = useState(false);
  const [faceState, setFaceState] = useState("unknown");
  const [gazeState, setGazeState] = useState("unknown"); // NEW
  const [events, setEvents] = useState([]);

  // ... rest unchanged ...

  return (
    <div className="app">
      {/* ... topbar and controls unchanged ... */}
      <div className="main-grid">
        <WebcamFeed 
          active={active} 
          onSignalChange={setFaceState} 
          onEvent={handleEvent} 
        />
        <SignalLog 
          faceState={faceState} 
          gazeState={gazeState} // NEW
          events={events} 
        />
      </div>
      {/* ... controls unchanged ... */}
    </div>
  );
}
```

---

## Backend: No Changes Required

The backend API remains unchanged. Phase 2 events flow through the existing `/log-event` endpoint:

```json
POST /log-event
{
  "session_id": "...",
  "event_type": "looking_away",
  "timestamp": "2026-10-08T13:00:00.000Z",
  "meta": { "yaw_degrees": 32 }
}
```

---

## Testing Checklist

### Unit-Level Tests

1. **Head Yaw Calculation**
   ```javascript
   // Test: Face looking straight ahead
   const landmarks_straight = [...]; // normalized to 0° yaw
   const yaw = calculateHeadYaw(landmarks_straight);
   expect(Math.abs(yaw)).toBeLessThan(5);

   // Test: Face rotated 30° left
   const landmarks_left = [...]; // rotated
   const yaw = calculateHeadYaw(landmarks_left);
   expect(yaw).toBeLessThan(-20);
   ```

2. **Yaw Smoothing**
   ```javascript
   const smooth1 = smoothYaw(45, 0, 0.3);   // 13.5
   const smooth2 = smoothYaw(45, smooth1, 0.3); // ~20
   // Verify exponential convergence
   ```

### Integration Tests (Manual)

1. **Normal behavior (should NOT trigger)**
   - [ ] Small head tilts (<20°) don't trigger event
   - [ ] Turning away briefly (<5s) doesn't trigger event
   - [ ] Micro-movements while focused don't spam events

2. **Suspicious behavior (SHOULD trigger)**
   - [ ] Turn head 30° away for 6+ seconds → "looking_away" fires once
   - [ ] Return to looking forward → counter resets
   - [ ] Turn away again → event fires again

3. **Edge cases**
   - [ ] Face partially out of frame → graceful degradation (no landmarks, skip gaze check)
   - [ ] Rapid head movements → smoothing prevents jitter
   - [ ] Yaw threshold tuning → adjust `LOOKING_AWAY_THRESHOLD_DEGREES` for your use case

---

## Tuning Parameters

Adjust these based on your specific requirements:

```javascript
// How many degrees off-center triggers "looking away"?
const LOOKING_AWAY_THRESHOLD_DEGREES = 25; // Default: ±25°
// Increase if false positives; decrease for sensitivity

// How long must student look away before event fires?
const LOOKING_AWAY_DURATION_SECONDS = 5; // Default: 5 seconds
// Increase to reduce false positives; decrease for quicker detection

// Smoothing factor for yaw (0-1, lower = more smoothing)
const ALPHA = 0.3; // Default: 0.3
// Increase if response is too sluggish; decrease if too jittery
```

### Recommended Starting Point

For a typical exam (45–60 minutes):
- **Threshold:** ±25°
- **Duration:** 5 seconds
- **Smoothing:** 0.3
- **Test with a live exam:** Get 5–10 students to take a mock exam, collect false-positive rates, iterate

---

## Common Pitfalls & Solutions

| Problem | Cause | Solution |
|---------|-------|----------|
| Yaw is stuck at 0° | Landmarks not being detected | Verify video quality, lighting, face visible |
| Too many false positives | Threshold too low or duration too short | Increase threshold to ±30° or duration to 7s |
| Event never fires | Duration threshold unrealistic for exam | Reduce duration to 3–4s; instructor can tune |
| Jittery yaw values | Smoothing alpha too high | Reduce alpha from 0.3 to 0.2 |
| High CPU usage | Landmark detection every frame is expensive | Consider skipping every other frame (30fps → 15fps detection) |

---

## Implementation Order

1. **Create `faceLandmarker.js`** — Implement all three functions (init, detect, calculate yaw)
2. **Test landmarker alone** — Verify model loads, logs raw yaw values to console
3. **Integrate into `WebcamFeed.jsx`** — Add landmark detection to render loop
4. **Add gaze signal evaluation** — Implement `evaluateGazeSignal()` logic
5. **Update `SignalLog.jsx`** — Wire gaze state to UI
6. **Manual testing** — Verify detection works as expected
7. **Tune thresholds** — Adjust for your use case

---

## Success Criteria (Phase 2 "Done")

- ✅ Turning head >25° for >5s triggers "looking_away" event
- ✅ Small head movements don't cause false positives
- ✅ Yaw angle displayed on-screen for debugging
- ✅ Events logged to backend and visible in event log
- ✅ Gaze signal status lights up in SignalLog UI
- ✅ 60s mock session produces accurate, de-duplicated events

---

## Next Steps

Once Phase 2 is complete and tested:
- Move to **Phase 3: Browser Signals** (tab switch, window blur) — simpler than gaze, ~2–3 days
- Then **Phase 4: Event Pipeline Polish** — handle edge cases, schema refinement
- Finally **Phase 5: Report Dashboard** — where the UI work matters

