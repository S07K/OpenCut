/**
 * Waveform peak extraction.
 *
 * Split into a pure reducer (`computePeaks`) and a thin browser shell
 * (`extractWaveform`). The reducer is where all the logic lives and is fully
 * unit-tested; the shell only decodes audio bytes. That split is deliberate —
 * peak bucketing is easy to get subtly wrong and impossible to eyeball.
 */

/**
 * Peaks for one audio source.
 *
 * Min and max are stored **separately** rather than as a single amplitude.
 * Collapsing them to `abs()` loses the waveform's asymmetry and produces the
 * flat, lifeless bars you see in amateur editors.
 */
export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  /** Number of buckets; equals `min.length`. */
  resolution: number;
}

/**
 * Reduces raw samples into `resolution` min/max buckets.
 *
 * Downsampling by peak rather than by average is what preserves transients — a
 * drum hit that occupies three samples out of a thousand must still be visible,
 * and averaging would erase it entirely.
 */
export function computePeaks(samples: Float32Array, resolution: number): WaveformPeaks {
  const buckets = Math.max(1, Math.floor(resolution));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);

  if (samples.length === 0) return { min, max, resolution: buckets };

  const samplesPerBucket = samples.length / buckets;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket);
    // Guaranteed to advance at least one sample, so no bucket is ever empty
    // when there is data — an empty bucket would render as a gap in the middle
    // of continuous audio.
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((bucket + 1) * samplesPerBucket)));

    let bucketMin = Infinity;
    let bucketMax = -Infinity;

    for (let index = start; index < end; index += 1) {
      const value = samples[index] ?? 0;
      if (value < bucketMin) bucketMin = value;
      if (value > bucketMax) bucketMax = value;
    }

    min[bucket] = Number.isFinite(bucketMin) ? bucketMin : 0;
    max[bucket] = Number.isFinite(bucketMax) ? bucketMax : 0;
  }

  return { min, max, resolution: buckets };
}

/**
 * Mixes multi-channel audio down to mono by averaging.
 *
 * The waveform is a visual summary, not an audio path — showing one lane per
 * channel doubles the visual noise without helping anyone find their edit point.
 */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const first = channels[0]!;
  if (channels.length === 1) return first;

  const mono = new Float32Array(first.length);
  for (let index = 0; index < first.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    mono[index] = sum / channels.length;
  }

  return mono;
}

/** Serializable form, for persisting peaks alongside the media asset. */
export interface SerializedWaveform {
  resolution: number;
  min: number[];
  max: number[];
}

export function serializeWaveform(peaks: WaveformPeaks): SerializedWaveform {
  return {
    resolution: peaks.resolution,
    min: Array.from(peaks.min),
    max: Array.from(peaks.max),
  };
}

export function deserializeWaveform(data: SerializedWaveform): WaveformPeaks {
  return {
    resolution: data.resolution,
    min: Float32Array.from(data.min),
    max: Float32Array.from(data.max),
  };
}

/** How many buckets to compute per source. */
export const DEFAULT_WAVEFORM_RESOLUTION = 2048;

/**
 * Decodes an audio or video file and extracts its waveform.
 *
 * Browser-only. Returns `null` rather than throwing when the file carries no
 * decodable audio — a silent video is a normal thing to import, not an error.
 */
export async function extractWaveform(
  file: Blob,
  resolution = DEFAULT_WAVEFORM_RESOLUTION,
): Promise<WaveformPeaks | null> {
  const AudioContextCtor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  try {
    const buffer = await file.arrayBuffer();
    const audio = await context.decodeAudioData(buffer);

    const channels: Float32Array[] = [];
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      channels.push(audio.getChannelData(channel));
    }

    return computePeaks(mixToMono(channels), resolution);
  } catch {
    // Video with no audio track, or a codec this browser cannot decode.
    return null;
  } finally {
    // Audio contexts are a limited per-page resource; leaking one per import
    // would break importing after a few dozen files.
    void context.close();
  }
}
