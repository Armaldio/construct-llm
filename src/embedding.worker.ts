import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

// Optional: Configure environment, disable local models if we want to fetch from HF Hub
// Note: In an Electron app, fetching from HF hub is fine, it caches in browser storage.
env.allowLocalModels = false;

interface Tensor {
  tolist(): number[][];
}

let embedder: FeatureExtractionPipeline | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { id, texts } = event.data as { id: string; texts: string[] };

  try {
    if (!embedder) {
      console.log("[Worker] Initializing feature-extraction pipeline...");
      try {
        // Try to initialize with WebGPU
        embedder = (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          device: "webgpu",
          dtype: "fp32",
        })) as FeatureExtractionPipeline;
        console.log("[Worker] Pipeline initialized with WebGPU.");
      } catch (gpuError) {
        console.warn(
          "[Worker] WebGPU not available or failed, falling back to WASM/CPU:",
          gpuError,
        );
        // Fallback to default WASM/CPU
        embedder = (await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
        )) as FeatureExtractionPipeline;
        console.log("[Worker] Pipeline initialized with WASM/CPU.");
      }
    }

    const outputs = (await embedder(texts, {
      pooling: "mean",
      normalize: true,
    })) as unknown as Tensor;

    // In Transformers.js v3/v4, tolist() returns the nested array
    const result = outputs.tolist();

    self.postMessage({ id, embeddings: result });
  } catch (error: unknown) {
    console.error("[Worker] Embedding error:", error);
    self.postMessage({ id, error: (error as Error).message });
  }
};
