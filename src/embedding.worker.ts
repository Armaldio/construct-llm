import { pipeline, env } from "@huggingface/transformers";

// Optional: Configure environment, disable local models if we want to fetch from HF Hub
// Note: In an Electron app, fetching from HF hub is fine, it caches in browser storage.
env.allowLocalModels = false;

let embedder: any = null;

self.onmessage = async (event: MessageEvent) => {
  const { id, texts } = event.data;

  try {
    if (!embedder) {
      console.log("[Worker] Initializing feature-extraction pipeline...");
      try {
        // Try to initialize with WebGPU
        embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          device: "webgpu",
          dtype: "fp32",
        });
        console.log("[Worker] Pipeline initialized with WebGPU.");
      } catch (gpuError) {
        console.warn(
          "[Worker] WebGPU not available or failed, falling back to WASM/CPU:",
          gpuError,
        );
        // Fallback to default WASM/CPU
        embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
        console.log("[Worker] Pipeline initialized with WASM/CPU.");
      }
    }

    const outputs = await embedder(texts, { pooling: "mean", normalize: true });

    // Ensure we handle the tensor output correctly
    // The output tensor shape is [batch_size, sequence_length]
    const num_texts = texts.length;
    const dim = 384; // all-MiniLM-L6-v2 dimension
    const result: number[][] = [];

    // Outputs.data is a Float32Array
    const dataArray = outputs.data;

    for (let i = 0; i < num_texts; i++) {
      result.push(Array.from(dataArray.slice(i * dim, (i + 1) * dim)));
    }

    self.postMessage({ id, embeddings: result });
  } catch (error: any) {
    console.error("[Worker] Embedding error:", error);
    self.postMessage({ id, error: error.message });
  }
};
