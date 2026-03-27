import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import Tooltip from "primevue/tooltip";
import App from "./App.vue";
import EmbeddingWorker from "./embedding.worker?worker";

import "primeicons/primeicons.css";
import "./index.css";

// Setup WebGPU Worker for Embeddings
const worker = new EmbeddingWorker();

worker.onmessage = (event) => {
  const { id, embeddings, error } = event.data;
  (window as any).api.sendEmbeddingResult({ id, embeddings, error });
};

(window as any).api.onEmbeddingRequest((data: { id: number; texts: string[] }) => {
  worker.postMessage(data);
});

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: ".my-app-dark",
    },
  },
});
app.directive("tooltip", Tooltip);

app.mount("#app");
