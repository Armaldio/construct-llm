<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Listbox from 'primevue/listbox';
import Card from 'primevue/card';
import Divider from 'primevue/divider';
import MarkdownIt from 'markdown-it';
import C3EventPreview from './C3EventPreview.vue';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
}

interface Project {
  id: string;
  name: string;
  path: string;
  threads: ChatThread[];
}

interface AppState {
  projects: Project[];
  activeProjectId: string | null;
}

const appState = ref<AppState>({ projects: [], activeProjectId: null });
const currentProject = ref<Project | null>(null);
const activeThreadId = ref<string | null>(null);
const activeThread = ref<ChatThread | null>(null);
const newMessage = ref('');
const isIndexing = ref(false);
const reflections = ref<string[]>([]);
const isStreaming = ref(false);
const inputRef = ref<any>(null);
const messagesContainer = ref<HTMLElement | null>(null);
const isStartingUp = ref(true);
const startupStatus = ref({ step: 'Initializing...', detail: '' });

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

onMounted(async () => {
  // Listen for startup progress
  (window as any).api.onStartupProgress((data: any) => {
    startupStatus.value = data;
  });

  (window as any).api.onStartupComplete(() => {
    isStartingUp.value = false;
  });

  // Check if we already finished (useful for HMR)
  const ready = await (window as any).api.isStartupComplete();
  if (ready) {
    isStartingUp.value = false;
  }

  const state = await (window as any).api.getAppState();
  if (state) {
    appState.value = state;
    if (appState.value.activeProjectId) {
      const project = appState.value.projects.find(p => p.id === appState.value.activeProjectId);
      if (project) {
        currentProject.value = project;
      }
    }
  }

  (window as any).api.onIndexingStatus((data: any) => {
    if (data.status === 'indexing') {
      isIndexing.value = true;
    } else {
      isIndexing.value = false;
    }
  });

  (window as any).api.onAgentReflection((data: any) => {
    if (data.type === 'tool-call') {
      reflections.value.push(`Searching project via ${data.toolName}...`);
    }
  });

  (window as any).api.onAgentChunk((chunk: string) => {
    if (isStreaming.value && currentProject.value && activeThreadId.value) {
      const thread = currentProject.value.threads.find(t => t.id === activeThreadId.value);
      if (thread && thread.messages.length > 0) {
        const lastMsg = thread.messages[thread.messages.length - 1];
        if (lastMsg.role === 'assistant') {
          lastMsg.content += chunk;
          scrollToBottom();
        }
      }
    }
  });
});

// Watch for changes in activeProjectId
watch(() => appState.value.activeProjectId, (newId) => {
  if (newId) {
    currentProject.value = appState.value.projects.find(p => p.id === newId) || null;
  } else {
    currentProject.value = null;
  }
});

// Watch for changes in currentProject.threads and activeThreadId
watch([currentProject, activeThreadId], ([project, threadId]) => {
  if (project && threadId) {
    activeThread.value = project.threads.find(t => t.id === threadId) || null;
    scrollToBottom();
  } else {
    activeThread.value = null;
  }
}, { deep: true });

// Sync state back to main process
watch(appState, (newState) => {
  (window as any).api.updateAppState(JSON.parse(JSON.stringify(newState)));
}, { deep: true });

const loadProject = async () => {
  const project = await (window as any).api.selectProject();
  if (project) {
    // Check if it already exists in appState.projects
    const existingIndex = appState.value.projects.findIndex(p => p.id === project.id);
    if (existingIndex !== -1) {
      appState.value.projects[existingIndex] = project;
    } else {
      appState.value.projects.push(project);
    }
    appState.value.activeProjectId = project.id;
    currentProject.value = project;
  }
};

const forceReindex = async () => {
  if (isIndexing.value) return;
  await (window as any).api.forceReindex();
};

const onThreadChange = () => {
  if (currentProject.value && activeThreadId.value) {
    activeThread.value = currentProject.value.threads.find(t => t.id === activeThreadId.value) || null;
    scrollToBottom();
  }
};

const selectProject = (id: string) => {
  appState.value.activeProjectId = id;
  activeThreadId.value = null;
};

const deleteProject = async (id: string) => {
  const confirmed = confirm('Are you sure you want to delete this project and all its chat history? This will not delete the project files on your disk.');
  if (confirmed) {
    const success = await (window as any).api.deleteProject(id);
    if (success) {
      const index = appState.value.projects.findIndex(p => p.id === id);
      if (index !== -1) {
        appState.value.projects.splice(index, 1);
        if (appState.value.activeProjectId === id) {
          appState.value.activeProjectId = null;
          currentProject.value = null;
          activeThreadId.value = null;
        }
      }
    }
  }
};

const createNewThread = () => {
  if (!currentProject.value) return;
  
  const newThread: ChatThread = {
    id: Date.now().toString(),
    name: `New Chat ${currentProject.value.threads.length + 1}`,
    messages: [],
  };
  currentProject.value.threads.push(newThread);
  activeThreadId.value = newThread.id;
};

const deleteThread = (id: string) => {
  if (!currentProject.value) return;
  
  const confirmed = confirm('Are you sure you want to delete this chat thread?');
  if (confirmed) {
    const index = currentProject.value.threads.findIndex(t => t.id === id);
    if (index !== -1) {
      currentProject.value.threads.splice(index, 1);
      if (activeThreadId.value === id) {
        activeThreadId.value = null;
      }
    }
  }
};

const sendMessage = async () => {
  if (!newMessage.value.trim() || !activeThreadId.value || !currentProject.value || isStreaming.value) return;

  const thread = currentProject.value.threads.find((t) => t.id === activeThreadId.value);
  if (!thread) return;

  const content = newMessage.value;
  newMessage.value = '';
  reflections.value = [];

  thread.messages.push({ role: 'user', content });
  
  // Add placeholder for streaming assistant message
  thread.messages.push({ role: 'assistant', content: '' });
  isStreaming.value = true;
  scrollToBottom();

  try {
    const finalResponse = await (window as any).api.askQuestion({
      text: content,
      threadId: activeThreadId.value
    });
    // Ensure final text is set in case streaming missed some chunks or wasn't used
    const lastMsg = thread.messages[thread.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = finalResponse;
    }
  } catch (e) {
    console.error('Chat Error:', e);
  } finally {
    isStreaming.value = false;
    reflections.value = [];
    // Focus back after some time to ensure DOM is updated
    setTimeout(() => {
      if (inputRef.value?.$el) {
        inputRef.value.$el.focus();
      }
    }, 100);
  }
};

const parseMessageContent = (content: string) => {
  if (!content) return [];
  const segments: Array<{ type: 'text' | 'c3-clipboard', content: string }> = [];
  
  // Regex to find the start of a C3 clipboard JSON block
  const startRegex = /\{[\s\n]*"is-c3-clipboard-data"[\s\n]*:[\s\n]*true/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = startRegex.exec(content)) !== null) {
    const startIndex = match.index;
    
    // Check if we have text before this block
    let blockStartIndex = startIndex;
    
    // Try to find the matching closing brace
    let depth = 0;
    let endIndex = -1;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      if (escape) { escape = false; continue; }
      if (char === '\\\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') depth--;
      }
      
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      // Incomplete JSON (maybe still streaming)
      continue;
    }

    let blockEndIndex = endIndex + 1;

    // Detect if this block is wrapped in markdown code blocks
    const beforeBlock = content.substring(lastIndex, startIndex);
    const afterBlock = content.substring(blockEndIndex);
    
    const codeBlockStartMatch = beforeBlock.match(/```(?:json)?\s*$/);
    const codeBlockEndMatch = afterBlock.match(/^\s*```/);
    
    if (codeBlockStartMatch && codeBlockEndMatch) {
      // It's wrapped in backticks, let's include them in the "to be replaced" area
      blockStartIndex = startIndex - codeBlockStartMatch[0].length;
      blockEndIndex = blockEndIndex + codeBlockEndMatch[0].length;
    }

    // Push preceding text segment
    if (blockStartIndex > lastIndex) {
      segments.push({ type: 'text', content: content.substring(lastIndex, blockStartIndex) });
    }

    // Push the C3 clipboard segment
    const jsonContent = content.substring(startIndex, endIndex + 1);
    segments.push({ type: 'c3-clipboard', content: jsonContent });
    
    lastIndex = blockEndIndex;
    // Reset regex index to after our found block
    startRegex.lastIndex = lastIndex;
  }
  
  // Push remaining text
  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.substring(lastIndex) });
  }
  
  return segments;
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

</script>

<template>
  <div v-if="isStartingUp" class="startup-overlay">
    <div class="startup-content">
      <div class="startup-logo">
        <i class="pi pi-bolt text-primary" style="font-size: 3rem"></i>
      </div>
      <h1 class="startup-title">Construct LLM</h1>
      <div class="startup-status">
        <div class="status-step">{{ startupStatus.step }}</div>
        <div class="status-detail" v-if="startupStatus.detail">{{ startupStatus.detail }}</div>
      </div>
      <div class="startup-loader">
        <div class="loader-bar"></div>
      </div>
    </div>
  </div>
  <div class="app-container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Construct LLM</h2>
        <div class="flex flex-col gap-2">
          <Button @click="loadProject" label="Open Project" icon="pi pi-plus" class="w-full" size="small" />
          <Button v-if="currentProject" @click="forceReindex" label="Re-index Project" :icon="isIndexing ? 'pi pi-spin pi-refresh' : 'pi pi-refresh'" class="w-full p-button-secondary" size="small" :disabled="isIndexing" />
        </div>
        <div v-if="isIndexing" class="indexing-indicator">
          <i class="pi pi-spin pi-spinner" style="font-size: 0.8rem"></i>
          <span>Indexing project...</span>
        </div>
      </div>

      <div class="sidebar-section" v-if="appState.projects.length > 0">
        <div class="section-header">
          <h3>Projects</h3>
        </div>
        <Listbox
          v-model="appState.activeProjectId"
          :options="appState.projects"
          optionValue="id"
          class="w-full compact-listbox"
          @change="activeThreadId = null"
        >
          <template #option="slotProps">
            <div class="project-item">
              <span class="project-name">{{ slotProps.option.name }}</span>
              <Button 
                icon="pi pi-trash" 
                text 
                rounded 
                severity="danger" 
                size="small" 
                @click.stop="deleteProject(slotProps.option.id)"
                class="delete-btn"
              />
            </div>
          </template>
        </Listbox>
      </div>

      <Divider v-if="currentProject" />

      <div class="sidebar-section" v-if="currentProject">
        <div class="section-header">
          <h3>Chats</h3>
          <Button icon="pi pi-plus" text rounded size="small" @click="createNewThread" />
        </div>
        <Listbox
          v-model="activeThreadId"
          :options="currentProject.threads"
          optionValue="id"
          class="w-full compact-listbox"
          @change="onThreadChange"
        >
          <template #option="slotProps">
            <div class="project-item">
              <span class="project-name">{{ slotProps.option.name }}</span>
              <Button 
                icon="pi pi-trash" 
                text 
                rounded 
                severity="danger" 
                size="small" 
                @click.stop="deleteThread(slotProps.option.id)"
                class="delete-btn"
              />
            </div>
          </template>
        </Listbox>
      </div>
    </aside>

    <main class="chat-main">
      <header v-if="activeThread" class="chat-header">
        <h3>{{ activeThread.name }}</h3>
      </header>

      <div class="chat-messages" v-if="activeThread" ref="messagesContainer">
        <div class="messages-inner">
          <div v-for="(msg, index) in activeThread.messages" :key="index" :class="['message', msg.role]">
            <Card v-if="msg.content || msg.role === 'user'">
              <template #content>
                <div class="message-content">
                  <div class="message-header">
                    <strong>{{ msg.role === 'user' ? 'You' : 'Assistant' }}:</strong>
                    <Button icon="pi pi-copy" text rounded size="small" @click="copyToClipboard(msg.content)" v-tooltip="'Copy message'" />
                  </div>
                  <div v-if="msg.role === 'assistant'" class="markdown-body">
                    <template v-for="(segment, sIndex) in parseMessageContent(msg.content)" :key="sIndex">
                      <div v-if="segment.type === 'text'" v-html="md.render(segment.content || '...')"></div>
                      <div v-else class="c3-clipboard-block">
                        <div class="c3-block-header">
                          <div class="flex items-center gap-2">
                            <i class="pi pi-clone text-primary"></i>
                            <span class="font-bold">Construct 3 Events</span>
                          </div>
                          <Button label="Copy to C3" icon="pi pi-copy" size="small" class="p-button-sm" @click="copyToClipboard(segment.content)" />
                        </div>
                        <div class="c3-preview-container">
                          <C3EventPreview :data="JSON.parse(segment.content)" />
                        </div>
                      </div>
                    </template>
                  </div>
                  <p v-else>{{ msg.content }}</p>
                </div>
              </template>
            </Card>
          </div>

          <!-- Reflections / Thinking state -->
          <div v-if="isStreaming" class="reflections-container">
            <div v-for="(reflection, i) in reflections" :key="i" class="reflection-item">
              <i class="pi pi-search mr-2"></i>
              <span>{{ reflection }}</span>
            </div>
            <div v-if="reflections.length === 0" class="reflection-item">
              <i class="pi pi-spin pi-spinner mr-2"></i>
              <span>Thinking...</span>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-input" v-if="activeThread">
        <div class="input-group">
          <InputText 
            ref="inputRef"
            v-model="newMessage" 
            placeholder="Ask a question about your project..." 
            @keyup.enter="sendMessage" 
            fluid 
          />
          <Button icon="pi pi-send" @click="sendMessage" :disabled="!newMessage.trim() || isStreaming" />
        </div>
      </div>

      <div v-else class="empty-state">
        <div class="empty-state-content" v-if="currentProject">
          <i class="pi pi-comments" style="font-size: 3rem; color: #dee2e6; margin-bottom: 1rem;"></i>
          <p>Select or create a chat thread to start.</p>
          <Button label="New Chat" icon="pi pi-plus" text @click="createNewThread" />
        </div>
        <div class="empty-state-content" v-else>
          <i class="pi pi-folder-open" style="font-size: 3rem; color: #dee2e6; margin-bottom: 1rem;"></i>
          <p>Open a Construct 3 project to begin.</p>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: #f8f9fa;
  font-family: var(--font-family);
}

.sidebar {
  width: 280px;
  background-color: #ffffff;
  border-right: 1px solid #dee2e6;
  display: flex;
  flex-direction: column;
  padding: 1rem;
}

.sidebar-header {
  margin-bottom: 1.5rem;
}

.indexing-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #6366f1;
  margin-top: 0.5rem;
  font-weight: 500;
}

.sidebar-section {
  margin-bottom: 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.section-header h3 {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #adb5bd;
  letter-spacing: 0.05rem;
  margin: 0;
}

.compact-listbox :deep(.p-listbox-list) {
  padding: 0;
}

.compact-listbox :deep(.p-listbox-item) {
  padding: 0;
  font-size: 0.9rem;
}

.project-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.5rem;
}

.project-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 0.5rem;
}

.delete-btn {
  opacity: 0.5;
  transition: opacity 0.2s;
  width: 24px !important;
  height: 24px !important;
}

.project-item:hover .delete-btn,
.project-item.p-highlight .delete-btn {
  opacity: 1;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 0;
}

.chat-header {
  padding: 1rem;
  background-color: #ffffff;
  border-bottom: 1px solid #dee2e6;
}

.chat-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.chat-messages {
  flex: 1;
  padding: 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}

.messages-inner {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

.message {
  max-width: 85%;
  min-width: 0;
}

.message.user {
  align-self: flex-end;
}

.message.assistant {
  align-self: flex-start;
}

.reflections-container {
  align-self: flex-start;
  margin-left: 0.5rem;
  font-size: 0.85rem;
  color: #6366f1;
  background: #eff6ff;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px dashed #6366f1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.reflection-item {
  display: flex;
  align-items: center;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.message-header strong {
  font-size: 0.75rem;
  color: #6c757d;
  text-transform: uppercase;
  margin: 0;
}

.message-content {
  min-width: 0;
  overflow-wrap: break-word;
}

.message-content p {
  margin: 0;
  line-height: 1.5;
  white-space: pre-wrap;
}

.c3-clipboard-block {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  margin: 1rem 0;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  min-width: 0;
}

.c3-block-header {
  background: #f8fafc;
  padding: 0.5rem 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e2e8f0;
}

.c3-block-header span {
  font-size: 0.85rem;
  color: #334155;
}

.c3-preview-container {
  padding: 0;
  margin: 0;
  max-height: 300px;
  overflow: auto;
  background: white;
}

/* Markdown Styles */
.markdown-body :deep(h1), 
.markdown-body :deep(h2), 
.markdown-body :deep(h3) {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-body :deep(h1) { font-size: 1.5rem; }
.markdown-body :deep(h2) { font-size: 1.25rem; }
.markdown-body :deep(h3) { font-size: 1.1rem; }

.markdown-body :deep(p) {
  margin-top: 0;
  margin-bottom: 1rem;
}

.markdown-body :deep(ul), 
.markdown-body :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}

.markdown-body :deep(code) {
  padding: 0.2rem 0.4rem;
  margin: 0;
  font-size: 85%;
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

.markdown-body :deep(pre) {
  padding: 1rem;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.markdown-body :deep(pre code) {
  padding: 0;
  margin: 0;
  background-color: transparent;
  border: 0;
}

.chat-input {
  padding: 1.5rem;
  background-color: #ffffff;
  border-top: 1px solid #dee2e6;
}

.input-group {
  display: flex;
  gap: 0.5rem;
}

.empty-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: #6c757d;
}

.empty-state-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* Startup Overlay */
.startup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #f8fafc;
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: center;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.startup-content {
  text-align: center;
  max-width: 400px;
  width: 100%;
  padding: 2rem;
}

.startup-logo {
  margin-bottom: 1.5rem;
  animation: pulse 2s infinite ease-in-out;
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.startup-title {
  font-size: 2rem;
  font-weight: 800;
  color: #1e293b;
  margin-bottom: 2rem;
}

.startup-status {
  margin-bottom: 2rem;
  min-height: 4rem;
}

.status-step {
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.status-detail {
  font-size: 0.85rem;
  color: #64748b;
}

.startup-loader {
  height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
}

.loader-bar {
  height: 100%;
  background: var(--p-primary-color);
  width: 30%;
  border-radius: 2px;
  animation: loading 1.5s infinite ease-in-out;
}

@keyframes loading {
  0% { transform: translateX(-100%); width: 30%; }
  50% { width: 60%; }
  100% { transform: translateX(400%); width: 30%; }
}
</style>