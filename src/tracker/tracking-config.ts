/** MindAR 1.2.5: milliseconds in OneEuroFilter. Keep recognition thresholds intact. */
export const TRACKING_OPTIONS = {
    maxTrack: 1,
    warmupTolerance: 5,
    missTolerance: 8,
    filterMinCF: 0.001,
    // Lower than MindAR's 1000 default: less micro-jitter, with modest motion lag.
    filterBeta: 0.3,
} as const;
