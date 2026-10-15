/**
 * MediaPipe FaceLandmarker wrapper. Keep the WASM runtime version aligned with
 * the dependency resolved by package-lock.json.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const MEDIAPIPE_VERSION = "0.10.35";
let landmarker = null;
let landmarkerPromise = null;

export function initFaceLandmarker() {
  if (landmarker) return Promise.resolve(landmarker);
  if (landmarkerPromise) return landmarkerPromise;

  landmarkerPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
    );
    const instance = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.35,
      minFacePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
    landmarker = instance;
    return landmarker;
  })().catch((error) => {
    landmarkerPromise = null;
    throw error;
  });
  return landmarkerPromise;
}

export function detectLandmarks(video, timestampMs) {
  if (!landmarker) throw new Error("Face landmarker is not initialized.");
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return { faceLandmarks: [] };
  }
  return landmarker.detectForVideo(video, timestampMs);
}

export function calculateHeadYaw(landmarks) {
  const nose = landmarks?.[1];
  const leftEye = landmarks?.[33];
  const rightEye = landmarks?.[263];
  if (!nose || !leftEye || !rightEye) return 0;
  const eyeCenter = (leftEye.x + rightEye.x) / 2;
  const width = Math.abs(rightEye.x - leftEye.x);
  if (width < 1e-5) return 0;
  return Math.max(-45, Math.min(45, ((nose.x - eyeCenter) / width) * 150));
}

export function smoothYaw(previousYaw, currentYaw, alpha = 0.35) {
  if (!Number.isFinite(previousYaw)) return currentYaw;
  return previousYaw + alpha * (currentYaw - previousYaw);
}
