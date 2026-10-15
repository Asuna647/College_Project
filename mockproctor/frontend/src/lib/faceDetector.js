/**
 * MediaPipe FaceDetector wrapper. Runtime version matches the package version
 * resolved by the supplied project's lockfile (0.10.35).
 */
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

const MEDIAPIPE_VERSION = "0.10.35";
let detector = null;
let detectorPromise = null;

export function initFaceDetector() {
  if (detector) return Promise.resolve(detector);
  if (detectorPromise) return detectorPromise;

  detectorPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
    );
    const instance = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.35,
    });
    detector = instance;
    return detector;
  })().catch((error) => {
    detectorPromise = null;
    throw error;
  });
  return detectorPromise;
}

export function detectFaces(video, timestampMs) {
  if (!detector) throw new Error("Face detector is not initialized.");
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return { detections: [] };
  }
  const result = detector.detectForVideo(video, timestampMs);
  const detections = Array.isArray(result?.detections) ? result.detections : [];
  return {
    ...result,
    detections: detections.filter((detection) => {
      const score = Number(detection?.categories?.[0]?.score ?? 0);
      return Number.isFinite(score) && score >= 0.20;
    }),
  };
}
