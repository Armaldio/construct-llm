<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import * as monaco from "monaco-editor";
import { store } from "../../store";

const props = defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  placeholder: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:modelValue", "submit"]);

const containerRef = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

// Define custom monarch language for mentions
const registerMentionsLanguage = () => {
  const langId = "chat-input-lang";

  if (monaco.languages.getLanguages().some((l) => l.id === langId)) return langId;

  monaco.languages.register({ id: langId });

  monaco.languages.setMonarchTokensProvider(langId, {
    tokenizer: {
      root: [
        [/@[a-zA-Z0-9_/.-]+/, "mention-file"],
        [/#[a-zA-Z0-9_/.-]+/, "mention-object"],
        [/./, "text"],
      ],
    },
  });

  monaco.editor.defineTheme("chat-input-theme", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "mention-file", foreground: "3b82f6", fontStyle: "bold" },
      { token: "mention-object", foreground: "10b981", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#ffffff00",
      "editorCursor.foreground": "#3b82f6",
    },
  });

  // Register completion provider
  monaco.languages.registerCompletionItemProvider(langId, {
    triggerCharacters: ["@", "#"],
    provideCompletionItems: (model, position) => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const lastChar = textUntilPosition.trim().split("").pop();
      const isFile = textUntilPosition.includes("@") && !textUntilPosition.includes("#"); // simplified logic
      // Better logic: find the start of the current word being typed
      const lineContent = model.getLineContent(position.lineNumber);
      const currentWordStart = lineContent.lastIndexOf(" ", position.column - 2) + 1;
      const triggerChar = lineContent[currentWordStart];

      if (triggerChar === "@") {
        return {
          suggestions: store.allFiles.map((f: any) => ({
            label: f.label,
            kind: monaco.languages.CompletionItemKind.File,
            documentation: f.data.path,
            insertText: f.label,
            range: range,
          })),
        };
      } else if (triggerChar === "#") {
        return {
          suggestions: store.allEntities.map((e: any) => {
            let kind = monaco.languages.CompletionItemKind.Variable;
            let detail = "Object Type";
            const path = e.data?.path || "";

            if (path.includes("eventSheets")) {
              kind = monaco.languages.CompletionItemKind.File;
              detail = "Event Sheet";
            } else if (path.includes("layouts")) {
              kind = monaco.languages.CompletionItemKind.Folder;
              detail = "Layout";
            } else if (path.includes("families")) {
              kind = monaco.languages.CompletionItemKind.Interface;
              detail = "Family";
            } else if (path.includes("objectTypes")) {
              kind = monaco.languages.CompletionItemKind.Class;
              detail = "Object Type";
            }

            return {
              label: e.label,
              kind: kind,
              detail: detail,
              documentation: e.data.path,
              insertText: e.label,
              range: range,
            };
          }),
        };
      }

      return { suggestions: [] };
    },
  });

  return langId;
};

onMounted(() => {
  if (!containerRef.value) return;

  const langId = registerMentionsLanguage();

  editor = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: langId,
    theme: "chat-input-theme",
    minimap: { enabled: false },
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    scrollbar: {
      vertical: "hidden",
      horizontal: "hidden",
    },
    wordWrap: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "Inter, system-ui, sans-serif",
    padding: { top: 8, bottom: 8 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: "none",
    contextmenu: false,
  });

  editor.onDidChangeModelContent(() => {
    const value = editor?.getValue() || "";
    emit("update:modelValue", value);
    updateHeight();
  });

  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
    editor?.trigger("keyboard", "type", { text: "\n" });
  });

  editor.addCommand(
    monaco.KeyCode.Enter,
    () => {
      emit("submit");
    },
    "!suggestWidgetVisible && !shiftKey",
  ); // shiftKey condition isn't directly supported in string, but let's fix the logic

  // Better way to handle Enter vs Shift+Enter
  editor.onKeyDown((e) => {
    if (e.keyCode === monaco.KeyCode.Enter && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      emit("submit");
    }
  });

  updateHeight();
});

const updateHeight = () => {
  if (!editor || !containerRef.value) return;
  const contentHeight = Math.min(200, Math.max(40, editor.getContentHeight()));
  containerRef.value.style.height = `${contentHeight}px`;
  editor.layout();
};

watch(
  () => props.modelValue,
  (newVal) => {
    if (editor && newVal !== editor.getValue()) {
      editor.setValue(newVal);
    }
  },
);

onUnmounted(() => {
  editor?.dispose();
});

const focus = () => {
  editor?.focus();
};

defineExpose({ focus });
</script>

<template>
  <div class="monaco-chat-input-wrapper w-full relative">
    <div ref="containerRef" class="monaco-container w-full"></div>
    <div
      v-if="!modelValue"
      class="placeholder-overlay pointer-events-none absolute left-2 top-2 opacity-40 text-sm"
    >
      {{ placeholder }}
    </div>
  </div>
</template>

<style scoped>
.monaco-chat-input-wrapper {
  min-height: 40px;
}
.monaco-container {
  min-height: 40px;
  max-height: 200px;
}
.placeholder-overlay {
  padding-left: 2px;
}
</style>
