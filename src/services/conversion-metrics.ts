export interface ConversionMetricInput {
  format: string;
  engine: 'node-native' | 'convert-wasm' | 'unknown';
  success: boolean;
  durationMs: number;
}

interface ConversionMetricBucket {
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface ConversionMetricsState {
  totalConversions: number;
  totalSuccesses: number;
  totalFailures: number;
  totalDurationMs: number;
  byFormat: Record<string, ConversionMetricBucket>;
  byEngine: Record<string, ConversionMetricBucket>;
}

const emptyBucket = (): ConversionMetricBucket => ({
  successCount: 0,
  failureCount: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
});

const state: ConversionMetricsState = {
  totalConversions: 0,
  totalSuccesses: 0,
  totalFailures: 0,
  totalDurationMs: 0,
  byFormat: {},
  byEngine: {},
};

function addToBucket(bucket: ConversionMetricBucket, input: ConversionMetricInput): void {
  if (input.success) {
    bucket.successCount += 1;
  } else {
    bucket.failureCount += 1;
  }

  bucket.totalDurationMs += Math.max(0, input.durationMs);
  bucket.maxDurationMs = Math.max(bucket.maxDurationMs, Math.max(0, input.durationMs));
}

export function recordConversionMetric(input: ConversionMetricInput): void {
  state.totalConversions += 1;
  if (input.success) {
    state.totalSuccesses += 1;
  } else {
    state.totalFailures += 1;
  }
  state.totalDurationMs += Math.max(0, input.durationMs);

  if (!state.byFormat[input.format]) {
    state.byFormat[input.format] = emptyBucket();
  }
  if (!state.byEngine[input.engine]) {
    state.byEngine[input.engine] = emptyBucket();
  }

  addToBucket(state.byFormat[input.format], input);
  addToBucket(state.byEngine[input.engine], input);
}

function serializeBuckets(buckets: Record<string, ConversionMetricBucket>) {
  return Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => {
      const count = bucket.successCount + bucket.failureCount;
      const avgDurationMs = count > 0 ? bucket.totalDurationMs / count : 0;
      return [key, { ...bucket, avgDurationMs: Math.round(avgDurationMs) }];
    })
  );
}

export function getConversionMetricsSummary() {
  const avgDurationMs = state.totalConversions > 0
    ? state.totalDurationMs / state.totalConversions
    : 0;

  return {
    totalConversions: state.totalConversions,
    totalSuccesses: state.totalSuccesses,
    totalFailures: state.totalFailures,
    avgDurationMs: Math.round(avgDurationMs),
    byFormat: serializeBuckets(state.byFormat),
    byEngine: serializeBuckets(state.byEngine),
  };
}
