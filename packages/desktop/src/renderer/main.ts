// RagForge Desktop - Nautilus-style File Explorer
import './styles.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// Chat types (no xterm import needed)

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  thumbnail?: string;
}

interface IndexedItem {
  path: string;
  name: string;
  type: 'file' | 'directory';
  indexedAt: Date;
}

// State
let currentPath: string = '';
let initialCwd: string = '';
let homePath: string = '';
let entries: FileEntry[] = [];
let selectedEntries: Set<string> = new Set();
let indexedItems: IndexedItem[] = [];
let viewMode: 'grid' | 'list' = 'grid';
let historyStack: string[] = [];
let historyIndex: number = -1;

// Three.js state
let threeScene: THREE.Scene | null = null;
let threeCamera: THREE.PerspectiveCamera | null = null;
let threeRenderer: THREE.WebGLRenderer | null = null;
let threeControls: OrbitControls | null = null;
let threeAnimationId: number | null = null;

// DOM Elements
const fileGrid = document.getElementById('file-grid')!;
const breadcrumb = document.getElementById('breadcrumb')!;
const indexedList = document.getElementById('indexed-list')!;
const statusIndexed = document.getElementById('status-indexed')!;
const statusItems = document.getElementById('status-items')!;
const statusSelection = document.getElementById('status-selection')!;
const selectionInfo = document.getElementById('selection-info')!;
const contextMenu = document.getElementById('context-menu')!;

// Buttons
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const btnForward = document.getElementById('btn-forward') as HTMLButtonElement;
const btnUp = document.getElementById('btn-up') as HTMLButtonElement;
const btnRefresh = document.getElementById('btn-refresh')!;
const btnViewGrid = document.getElementById('btn-view-grid')!;
const btnViewList = document.getElementById('btn-view-list')!;
const placeHome = document.getElementById('place-home')!;
const placeCwd = document.getElementById('place-cwd')!;

// Context menu
const ctxOpen = document.getElementById('ctx-open')!;
const ctxIngest = document.getElementById('ctx-ingest')!;
const ctxIngestLabel = document.getElementById('ctx-ingest-label')!;
const ctxRemove = document.getElementById('ctx-remove')!;

// Right panel resize
const actionPanel = document.getElementById('action-panel')!;
const actionPanelWrapper = document.getElementById('action-panel-wrapper')!;
const resizeHandle = document.getElementById('resize-handle')!;
const btnTogglePanel = document.getElementById('btn-toggle-panel')!;
const toggleArrow = document.getElementById('toggle-arrow')!;

// Chat elements
const chatWrapper = document.getElementById('chat-wrapper')!;
const chatMessagesEl = document.getElementById('chat-messages')!;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatResizeHandle = document.getElementById('chat-resize-handle')!;
const btnChatClear = document.getElementById('btn-chat-clear')!;
const btnChatPopout = document.getElementById('btn-chat-popout')!;
const btnChatToggle = document.getElementById('btn-chat-toggle')!;
const btnChatSend = document.getElementById('btn-chat-send') as HTMLButtonElement;
const chatConversationSelect = document.getElementById('chat-conversation-select') as HTMLSelectElement;
const btnChatNew = document.getElementById('btn-chat-new')!;

// Search elements
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchIndexedOnly = document.getElementById('search-indexed-only') as HTMLInputElement;

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// Panel state
let panelWidth = 256; // 16rem = 256px
let panelCollapsed = false;
const MIN_PANEL_WIDTH = 192; // 12rem
const MAX_PANEL_WIDTH = 384; // 24rem

// Chat state
interface ChatMessageUI {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: Array<{ name: string; status: 'pending' | 'success' | 'error'; duration?: number }>;
  isStreaming?: boolean;
}
let chatMessagesData: ChatMessageUI[] = [];
let chatHeight = 300;
let chatCollapsed = false;
let isChatLoading = false;
let currentConversationId: string | null = null;
const MIN_CHAT_HEIGHT = 100;
const MAX_CHAT_HEIGHT = 500;

// File type helpers
const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const textExtensions = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'yaml', 'yml', 'toml', 'html', 'css', 'scss', 'less', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh', 'sql', 'xml', 'vue', 'svelte', 'env', 'gitignore', 'dockerfile'];
const model3DExtensions = ['glb', 'gltf'];
const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  const ext = getFileExtension(name);
  if (imageExtensions.includes(ext)) return '🖼️';
  if (model3DExtensions.includes(ext)) return '🎮';
  const icons: Record<string, string> = {
    ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    vue: '💚', svelte: '🧡',
    py: '🐍', rb: '💎', go: '🐹', rs: '🦀',
    md: '📝', txt: '📄',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    html: '🌐', css: '🎨', scss: '🎨',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬',
    zip: '📦', tar: '📦', gz: '📦',
    sh: '⚙️', env: '🔐', lock: '🔒',
  };
  return icons[ext] || '📄';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString();
}

function isIndexed(path: string): boolean {
  return indexedItems.some(item => item.path === path || path.startsWith(item.path + '/'));
}

function isDirectlyIndexed(path: string): boolean {
  return indexedItems.some(item => item.path === path);
}

// Navigation
async function navigateTo(path: string, addToHistory = true) {
  if (addToHistory) {
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(path);
    historyIndex = historyStack.length - 1;
  }

  currentPath = path;
  selectedEntries.clear();
  cleanupThreeJS();

  entries = await loadDirectory(path);

  renderBreadcrumb();
  renderGrid();
  updateNavButtons();
  updateSelectionInfo();
  updateStatus();
}

async function loadDirectory(dirPath: string): Promise<FileEntry[]> {
  if (!isElectron) {
    return [
      { name: 'Documents', path: `${dirPath}/Documents`, isDirectory: true },
      { name: 'example.ts', path: `${dirPath}/example.ts`, isDirectory: false, size: 1234 },
    ];
  }

  try {
    const result = await window.electronAPI.fs.readDirectory(dirPath);

    const entriesWithThumbs = await Promise.all(
      result.map(async (entry) => {
        if (!entry.isDirectory) {
          const ext = getFileExtension(entry.name);
          if (imageExtensions.includes(ext)) {
            try {
              const thumb = await window.electronAPI.fs.getThumbnail(entry.path);
              if (thumb) return { ...entry, thumbnail: thumb };
            } catch {}
          }
        }
        return entry;
      })
    );

    return entriesWithThumbs;
  } catch (error) {
    console.error('Error loading directory:', error);
    return [];
  }
}

function renderBreadcrumb() {
  const parts = currentPath.split('/').filter(Boolean);
  const MAX_VISIBLE = 3;

  let html = `<button class="px-2 py-1 hover:bg-bg-hover rounded text-gray-400 shrink-0" data-path="/">/</button>`;

  // Build paths for each part
  const pathParts: { name: string; path: string }[] = [];
  let accumulated = '';
  for (const part of parts) {
    accumulated += '/' + part;
    pathParts.push({ name: part, path: accumulated });
  }

  if (pathParts.length > MAX_VISIBLE) {
    // Show ellipsis that navigates to parent of visible parts
    const hiddenPath = pathParts[pathParts.length - MAX_VISIBLE - 1]?.path || '/';
    html += `<span class="text-gray-600 shrink-0">/</span>`;
    html += `<button class="px-2 py-1 hover:bg-bg-hover rounded text-gray-500 shrink-0" data-path="${hiddenPath}" title="Go to ${hiddenPath}">...</button>`;

    // Show last MAX_VISIBLE parts
    const visibleParts = pathParts.slice(-MAX_VISIBLE);
    visibleParts.forEach((part, i) => {
      html += `<span class="text-gray-600 shrink-0">/</span>`;
      // Last 2 parts: no truncate, full width
      const isLastTwo = i >= visibleParts.length - 2;
      html += `<button class="px-2 py-1 hover:bg-bg-hover rounded ${isLastTwo ? 'shrink-0' : 'truncate max-w-24 shrink'}" data-path="${part.path}" title="${part.name}">${part.name}</button>`;
    });
  } else {
    // Show all parts, last 2 without truncate
    pathParts.forEach((part, i) => {
      html += `<span class="text-gray-600 shrink-0">/</span>`;
      const isLastTwo = i >= pathParts.length - 2;
      html += `<button class="px-2 py-1 hover:bg-bg-hover rounded ${isLastTwo ? 'shrink-0' : 'truncate max-w-24 shrink'}" data-path="${part.path}" title="${part.name}">${part.name}</button>`;
    });
  }

  breadcrumb.innerHTML = html;
  breadcrumb.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path');
      if (path) navigateTo(path);
    });
  });
}

function renderGrid() {
  if (entries.length === 0) {
    fileGrid.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-600">
      <div class="text-5xl mb-3 opacity-30">📂</div><p class="text-sm">Empty folder</p></div>`;
    return;
  }

  if (viewMode === 'grid') {
    fileGrid.innerHTML = `<div class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2"></div>`;
    const grid = fileGrid.firstElementChild!;
    for (const entry of entries) grid.appendChild(createGridItem(entry));
  } else {
    fileGrid.innerHTML = `<div class="flex flex-col gap-0.5"></div>`;
    const list = fileGrid.firstElementChild!;
    for (const entry of entries) list.appendChild(createListItem(entry));
  }
}

function createGridItem(entry: FileEntry): HTMLElement {
  const item = document.createElement('div');
  const isSelected = selectedEntries.has(entry.path);
  const indexed = isIndexed(entry.path);
  const directlyIndexed = isDirectlyIndexed(entry.path);

  item.className = `relative flex flex-col items-center p-2 rounded-lg cursor-pointer transition-all ${
    isSelected ? 'bg-accent/30 ring-2 ring-accent' : 'hover:bg-bg-hover'
  }`;

  const iconHtml = entry.thumbnail
    ? `<img src="${entry.thumbnail}" class="w-16 h-16 object-cover rounded" alt="${entry.name}">`
    : `<div class="w-16 h-16 flex items-center justify-center text-4xl">${getFileIcon(entry.name, entry.isDirectory)}</div>`;

  const badge = directlyIndexed
    ? `<div class="absolute top-1 right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xs shadow">✓</div>`
    : indexed
    ? `<div class="absolute top-1 right-1 w-5 h-5 bg-emerald-500/50 rounded-full"></div>`
    : '';

  item.innerHTML = `${badge}${iconHtml}<span class="mt-1 text-xs text-center w-full truncate px-1 ${indexed ? 'text-emerald-400' : ''}">${entry.name}</span>`;

  item.addEventListener('click', (e) => handleItemClick(entry, e));
  item.addEventListener('dblclick', () => handleItemDoubleClick(entry));
  item.addEventListener('contextmenu', (e) => handleContextMenu(entry, e));

  return item;
}

function createListItem(entry: FileEntry): HTMLElement {
  const item = document.createElement('div');
  const isSelected = selectedEntries.has(entry.path);
  const indexed = isIndexed(entry.path);
  const directlyIndexed = isDirectlyIndexed(entry.path);

  item.className = `flex items-center px-3 py-2 rounded cursor-pointer transition-all ${
    isSelected ? 'bg-accent/30' : 'hover:bg-bg-hover'
  }`;

  const indexedIcon = directlyIndexed ? `<span class="text-emerald-500 text-sm mr-2">✓</span>`
    : indexed ? `<span class="text-emerald-500/50 text-sm mr-2">○</span>`
    : `<span class="w-4 mr-2"></span>`;

  item.innerHTML = `${indexedIcon}<span class="text-xl mr-3">${getFileIcon(entry.name, entry.isDirectory)}</span>
    <span class="flex-1 truncate ${indexed ? 'text-emerald-400' : ''}">${entry.name}</span>
    ${entry.size !== undefined ? `<span class="text-gray-500 text-xs ml-4">${formatSize(entry.size)}</span>` : ''}`;

  item.addEventListener('click', (e) => handleItemClick(entry, e));
  item.addEventListener('dblclick', () => handleItemDoubleClick(entry));
  item.addEventListener('contextmenu', (e) => handleContextMenu(entry, e));

  return item;
}

function handleItemClick(entry: FileEntry, e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    if (selectedEntries.has(entry.path)) selectedEntries.delete(entry.path);
    else selectedEntries.add(entry.path);
  } else {
    selectedEntries.clear();
    selectedEntries.add(entry.path);
  }

  renderGrid();
  updateSelectionInfo();
}

async function handleItemDoubleClick(entry: FileEntry) {
  if (entry.isDirectory) {
    navigateTo(entry.path);
  } else if (isElectron) {
    const ext = getFileExtension(entry.name);
    if (textExtensions.includes(ext)) {
      await window.electronAPI.fs.openWithEditor(entry.path);
    }
  }
}

function handleContextMenu(entry: FileEntry, e: MouseEvent) {
  e.preventDefault();

  if (!selectedEntries.has(entry.path)) {
    selectedEntries.clear();
    selectedEntries.add(entry.path);
    renderGrid();
    updateSelectionInfo();
  }

  const indexed = isDirectlyIndexed(entry.path);
  ctxOpen.classList.toggle('hidden', !entry.isDirectory);
  ctxIngestLabel.textContent = entry.isDirectory ? 'Ingest Directory' : 'Ingest File';
  ctxIngest.classList.toggle('hidden', indexed);
  ctxRemove.classList.toggle('hidden', !indexed);

  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.classList.remove('hidden');
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
}

// Selection info with preview
async function updateSelectionInfo() {
  const count = selectedEntries.size;
  statusSelection.textContent = count > 0 ? `${count} selected` : '';

  if (count === 0) {
    cleanupThreeJS();
    selectionInfo.innerHTML = `<div class="text-center text-gray-600 text-sm py-8">
      <p>Select files or folders</p><p class="text-xs mt-1">Right-click for options</p></div>`;
    return;
  }

  const selectedEntry = entries.find(e => selectedEntries.has(e.path));
  if (count !== 1 || !selectedEntry) {
    cleanupThreeJS();
    selectionInfo.innerHTML = `<div class="text-center py-8">
      <div class="text-3xl mb-2">📑</div><div class="font-medium">${count} items selected</div></div>`;
    return;
  }

  // Single selection - show detailed preview
  const ext = getFileExtension(selectedEntry.name);
  const indexed = isDirectlyIndexed(selectedEntry.path);

  let previewHtml = '';
  let statsHtml = '';

  // Build stats section
  if (selectedEntry.isDirectory) {
    statsHtml = `<div class="text-xs text-gray-500 space-y-1 mb-3" id="dir-stats">
      <div class="flex justify-between"><span>Contents:</span><span class="text-gray-400">Loading...</span></div>
    </div>`;
  } else {
    statsHtml = `<div class="text-xs text-gray-500 space-y-1 mb-3">
      <div class="flex justify-between"><span>Size:</span><span class="text-gray-400">${formatSize(selectedEntry.size || 0)}</span></div>
      ${selectedEntry.modified ? `<div class="flex justify-between"><span>Modified:</span><span class="text-gray-400">${formatDate(selectedEntry.modified)}</span></div>` : ''}
      <div class="flex justify-between"><span>Type:</span><span class="text-gray-400">${ext.toUpperCase() || 'File'}</span></div>
    </div>`;
  }

  // Preview section
  if (selectedEntry.thumbnail) {
    previewHtml = `<div class="mb-3 rounded overflow-hidden bg-black/20">
      <img src="${selectedEntry.thumbnail}" class="w-full h-40 object-contain" alt="Preview">
    </div>`;
  } else if (model3DExtensions.includes(ext)) {
    previewHtml = `<div id="three-container" class="mb-3 rounded overflow-hidden bg-black/50 h-48"></div>`;
  } else if (textExtensions.includes(ext)) {
    previewHtml = `<div id="code-preview" class="mb-3 rounded bg-black/30 p-2 h-40 overflow-auto text-xs font-mono text-gray-400">
      <span class="text-gray-600">Loading...</span>
    </div>`;
  } else if (documentExtensions.includes(ext)) {
    previewHtml = `<div class="mb-3 rounded bg-black/30 p-4 text-center">
      <div class="text-4xl mb-2">${getFileIcon(selectedEntry.name, false)}</div>
      <p class="text-xs text-gray-500">Document preview not available</p>
      <button id="btn-open-doc" class="mt-2 text-xs text-accent hover:underline">Open with system app</button>
    </div>`;
  }

  // Actions
  const actionsHtml = `<div class="space-y-2 border-t border-border pt-3">
    ${selectedEntry.isDirectory ? `
      <button id="btn-ingest" class="w-full px-3 py-2 rounded text-sm font-medium ${indexed ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-accent text-white hover:bg-accent-hover'} transition-all" ${indexed ? 'disabled' : ''}>
        ✨ Ingest Directory
      </button>
    ` : `
      <button id="btn-ingest" class="w-full px-3 py-2 rounded text-sm font-medium ${indexed ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-accent text-white hover:bg-accent-hover'} transition-all" ${indexed ? 'disabled' : ''}>
        ✨ Ingest File
      </button>
      ${textExtensions.includes(ext) ? `
        <button id="btn-edit" class="w-full px-3 py-2 rounded text-sm font-medium border border-border bg-bg-hover text-gray-300 hover:bg-bg-selected transition-all">
          📝 Open in Editor
        </button>
      ` : ''}
    `}
    ${indexed ? `
      <button id="btn-remove" class="w-full px-3 py-2 rounded text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all">
        ✗ Remove from Index
      </button>
    ` : ''}
  </div>`;

  // Header
  const headerHtml = `<div class="text-center mb-3 pb-3 border-b border-border">
    <div class="text-3xl mb-1">${selectedEntry.thumbnail ? '' : getFileIcon(selectedEntry.name, selectedEntry.isDirectory)}</div>
    <div class="font-medium truncate text-sm" title="${selectedEntry.name}">${selectedEntry.name}</div>
    ${indexed ? '<div class="text-xs text-emerald-400 mt-1">✓ Indexed</div>' : ''}
  </div>`;

  selectionInfo.innerHTML = headerHtml + previewHtml + statsHtml + actionsHtml;

  // Event handlers
  document.getElementById('btn-ingest')?.addEventListener('click', () => ingestItem(selectedEntry));
  document.getElementById('btn-remove')?.addEventListener('click', () => removeFromIndex(selectedEntry));
  document.getElementById('btn-edit')?.addEventListener('click', () => {
    if (isElectron) window.electronAPI.fs.openWithEditor(selectedEntry.path);
  });
  document.getElementById('btn-open-doc')?.addEventListener('click', () => {
    if (isElectron) window.electronAPI.fs.openWithEditor(selectedEntry.path);
  });

  // Load async content
  if (selectedEntry.isDirectory && isElectron) {
    const stats = await window.electronAPI.fs.getDirectoryStats(selectedEntry.path);
    const dirStatsEl = document.getElementById('dir-stats');
    if (dirStatsEl) {
      dirStatsEl.innerHTML = `
        <div class="flex justify-between"><span>Files:</span><span class="text-gray-400">${stats.fileCount}</span></div>
        <div class="flex justify-between"><span>Folders:</span><span class="text-gray-400">${stats.dirCount}</span></div>
        <div class="flex justify-between"><span>Total size:</span><span class="text-gray-400">${formatSize(stats.totalSize)}</span></div>
      `;
    }
  }

  if (textExtensions.includes(ext) && isElectron) {
    const content = await window.electronAPI.fs.readTextPreview(selectedEntry.path, 30);
    const codePreview = document.getElementById('code-preview');
    if (codePreview && content) {
      codePreview.innerHTML = escapeHtml(content);
    }
  }

  if (model3DExtensions.includes(ext) && isElectron) {
    const container = document.getElementById('three-container');
    if (container) {
      await init3DPreview(container, selectedEntry.path);
    }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Three.js 3D preview
async function init3DPreview(container: HTMLElement, filePath: string) {
  cleanupThreeJS();

  const width = container.clientWidth;
  const height = container.clientHeight;
  const aspect = width / height;

  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x1e1e1e);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  threeScene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7.5);
  threeScene.add(directionalLight);

  threeRenderer = new THREE.WebGLRenderer({ antialias: true });
  threeRenderer.setSize(width, height);
  threeRenderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(threeRenderer.domElement);

  // Load model
  if (isElectron) {
    try {
      const base64 = await window.electronAPI.fs.readBinaryFile(filePath);
      if (base64) {
        const binaryData = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([binaryData], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);

        const loader = new GLTFLoader();
        loader.load(url, (gltf) => {
          const model = gltf.scene;
          threeScene!.add(model);

          // Calculate bounding box
          const worldBox = new THREE.Box3().setFromObject(model);
          const worldCenter = worldBox.getCenter(new THREE.Vector3());
          const worldSize = worldBox.getSize(new THREE.Vector3());
          const halfSize = worldSize.clone().multiplyScalar(0.5);

          // Get bbox corners for projection
          const boxCorners = [
            new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y - halfSize.y, worldCenter.z - halfSize.z),
            new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y - halfSize.y, worldCenter.z + halfSize.z),
            new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y + halfSize.y, worldCenter.z - halfSize.z),
            new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y + halfSize.y, worldCenter.z + halfSize.z),
            new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y - halfSize.y, worldCenter.z - halfSize.z),
            new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y - halfSize.y, worldCenter.z + halfSize.z),
            new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y + halfSize.y, worldCenter.z - halfSize.z),
            new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y + halfSize.y, worldCenter.z + halfSize.z),
          ];

          // Perspective view: ~45° around Y, ~30° elevation
          const fov = 45;
          const viewDir = new THREE.Vector3(1, 0.6, 1).normalize();

          // Initial distance estimate
          const initialDistance = halfSize.length() * 3;

          // Create camera at initial position
          threeCamera = new THREE.PerspectiveCamera(fov, aspect, 0.1, initialDistance * 10);
          threeCamera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(initialDistance));
          threeCamera.up.set(0, 1, 0);
          threeCamera.lookAt(worldCenter);
          threeCamera.updateMatrixWorld();
          threeCamera.updateProjectionMatrix();

          // Project corners to NDC to find scale
          let minNdcX = Infinity, maxNdcX = -Infinity;
          let minNdcY = Infinity, maxNdcY = -Infinity;

          for (const point of boxCorners) {
            const projected = point.clone().project(threeCamera);
            minNdcX = Math.min(minNdcX, projected.x);
            maxNdcX = Math.max(maxNdcX, projected.x);
            minNdcY = Math.min(minNdcY, projected.y);
            maxNdcY = Math.max(maxNdcY, projected.y);
          }

          const ndcWidth = maxNdcX - minNdcX;
          const ndcHeight = maxNdcY - minNdcY;

          // Scale to fit 90% of frame
          const targetSize = 1.8;
          const scaleFactor = targetSize / Math.max(ndcWidth, ndcHeight);
          const newDistance = initialDistance / scaleFactor;

          // Move camera to new distance
          threeCamera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(newDistance));
          threeCamera.lookAt(worldCenter);
          threeCamera.updateMatrixWorld();

          // Center using Thales theorem
          const viewMatrix = threeCamera.matrixWorldInverse;
          let minTanX = Infinity, maxTanX = -Infinity;
          let minTanY = Infinity, maxTanY = -Infinity;

          for (const point of boxCorners) {
            const camSpacePoint = point.clone().applyMatrix4(viewMatrix);
            const depth = -camSpacePoint.z;
            if (depth > 0) {
              minTanX = Math.min(minTanX, camSpacePoint.x / depth);
              maxTanX = Math.max(maxTanX, camSpacePoint.x / depth);
              minTanY = Math.min(minTanY, camSpacePoint.y / depth);
              maxTanY = Math.max(maxTanY, camSpacePoint.y / depth);
            }
          }

          const tanCenterX = (minTanX + maxTanX) / 2;
          const tanCenterY = (minTanY + maxTanY) / 2;

          const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(threeCamera.quaternion);
          const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(threeCamera.quaternion);

          const offsetX = tanCenterX * newDistance;
          const offsetY = tanCenterY * newDistance;

          threeCamera.position.add(camRight.clone().multiplyScalar(offsetX));
          threeCamera.position.add(camUp.clone().multiplyScalar(offsetY));

          const newLookAt = worldCenter.clone()
            .add(camRight.clone().multiplyScalar(offsetX))
            .add(camUp.clone().multiplyScalar(offsetY));
          threeCamera.lookAt(newLookAt);
          threeCamera.updateProjectionMatrix();

          // Setup OrbitControls after camera is positioned
          threeControls = new OrbitControls(threeCamera, threeRenderer!.domElement);
          threeControls.enableDamping = true;
          threeControls.target.copy(newLookAt);
          threeControls.update();

          URL.revokeObjectURL(url);
        });
      }
    } catch (error) {
      console.error('Error loading 3D model:', error);
    }
  }

  // Animation loop
  function animate() {
    threeAnimationId = requestAnimationFrame(animate);
    threeControls?.update();
    if (threeRenderer && threeScene && threeCamera) {
      threeRenderer.render(threeScene, threeCamera);
    }
  }
  animate();
}

function cleanupThreeJS() {
  if (threeAnimationId) {
    cancelAnimationFrame(threeAnimationId);
    threeAnimationId = null;
  }
  if (threeRenderer) {
    threeRenderer.dispose();
    threeRenderer.domElement.remove();
    threeRenderer = null;
  }
  if (threeControls) {
    threeControls.dispose();
    threeControls = null;
  }
  threeScene = null;
  threeCamera = null;
}

function updateNavButtons() {
  btnBack.disabled = historyIndex <= 0;
  btnForward.disabled = historyIndex >= historyStack.length - 1;
  btnUp.disabled = currentPath === '/';
}

function updateStatus() {
  const dirs = entries.filter(e => e.isDirectory).length;
  const files = entries.length - dirs;
  statusItems.textContent = `${dirs} folders, ${files} files`;
}

function renderIndexedItems() {
  statusIndexed.textContent = indexedItems.length.toString();

  if (indexedItems.length === 0) {
    indexedList.innerHTML = `<div class="px-4 py-2 text-center text-gray-600 text-xs">No items indexed</div>`;
    return;
  }

  indexedList.innerHTML = indexedItems.map(item => `
    <div class="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-bg-hover rounded mx-2 text-xs" data-path="${item.path}">
      <span class="text-emerald-400">✓</span>
      <span class="flex-1 truncate" title="${item.path}">${item.name}</span>
      <span class="text-gray-600">${item.type === 'directory' ? '📁' : '📄'}</span>
    </div>
  `).join('');

  indexedList.querySelectorAll('[data-path]').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.getAttribute('data-path');
      if (path) {
        const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
        navigateTo(parentPath);
      }
    });
  });
}

function ingestItem(entry: FileEntry) {
  if (isDirectlyIndexed(entry.path)) return;

  indexedItems.push({
    path: entry.path,
    name: entry.name,
    type: entry.isDirectory ? 'directory' : 'file',
    indexedAt: new Date(),
  });

  renderIndexedItems();
  renderGrid();
  updateSelectionInfo();
  showToast(`${entry.isDirectory ? 'Directory' : 'File'} "${entry.name}" indexed`);
}

function removeFromIndex(entry: FileEntry) {
  indexedItems = indexedItems.filter(item => item.path !== entry.path);
  renderIndexedItems();
  renderGrid();
  updateSelectionInfo();
  showToast(`"${entry.name}" removed from index`);
}

function showToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-10 right-5 bg-bg-panel border border-border rounded-lg px-5 py-3 flex items-center gap-2.5 shadow-xl z-50 animate-slideIn border-l-4 border-l-emerald-400';
  toast.innerHTML = `<span class="text-emerald-400">✓</span><span class="text-sm text-gray-300">${message}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Event listeners
btnBack.addEventListener('click', () => {
  if (historyIndex > 0) {
    historyIndex--;
    navigateTo(historyStack[historyIndex], false);
  }
});

btnForward.addEventListener('click', () => {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    navigateTo(historyStack[historyIndex], false);
  }
});

btnUp.addEventListener('click', () => {
  const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
  navigateTo(parentPath);
});

btnRefresh.addEventListener('click', () => navigateTo(currentPath, false));

btnViewGrid.addEventListener('click', () => {
  viewMode = 'grid';
  btnViewGrid.classList.add('bg-bg-selected', 'text-gray-300');
  btnViewGrid.classList.remove('text-gray-500');
  btnViewList.classList.remove('bg-bg-selected', 'text-gray-300');
  btnViewList.classList.add('text-gray-500');
  renderGrid();
});

btnViewList.addEventListener('click', () => {
  viewMode = 'list';
  btnViewList.classList.add('bg-bg-selected', 'text-gray-300');
  btnViewList.classList.remove('text-gray-500');
  btnViewGrid.classList.remove('bg-bg-selected', 'text-gray-300');
  btnViewGrid.classList.add('text-gray-500');
  renderGrid();
});

placeHome.addEventListener('click', () => { if (homePath) navigateTo(homePath); });
placeCwd.addEventListener('click', () => { if (initialCwd) navigateTo(initialCwd); });

ctxOpen.addEventListener('click', () => {
  hideContextMenu();
  const entry = entries.find(e => selectedEntries.has(e.path));
  if (entry?.isDirectory) navigateTo(entry.path);
});

ctxIngest.addEventListener('click', () => {
  hideContextMenu();
  const entry = entries.find(e => selectedEntries.has(e.path));
  if (entry) ingestItem(entry);
});

ctxRemove.addEventListener('click', () => {
  hideContextMenu();
  const entry = entries.find(e => selectedEntries.has(e.path));
  if (entry) removeFromIndex(entry);
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target as Node)) hideContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideContextMenu();
    selectedEntries.clear();
    renderGrid();
    updateSelectionInfo();
  }
  if (e.key === 'Backspace' && !(e.target as HTMLElement)?.matches('input, textarea')) {
    btnUp.click();
  }
});

// Panel resize logic
let isResizing = false;

function setPanelWidth(width: number) {
  panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width));
  actionPanel.style.width = `${panelWidth}px`;
}

function togglePanel() {
  panelCollapsed = !panelCollapsed;
  if (panelCollapsed) {
    actionPanel.style.width = '0px';
    actionPanel.style.minWidth = '0px';
    actionPanel.style.overflow = 'hidden';
    toggleArrow.textContent = '‹';
    resizeHandle.style.display = 'none';
  } else {
    actionPanel.style.width = `${panelWidth}px`;
    actionPanel.style.minWidth = `${MIN_PANEL_WIDTH}px`;
    actionPanel.style.overflow = '';
    toggleArrow.textContent = '›';
    resizeHandle.style.display = '';
  }
}

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const wrapperRect = actionPanelWrapper.getBoundingClientRect();
  const newWidth = wrapperRect.right - e.clientX;
  setPanelWidth(newWidth);
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

btnTogglePanel.addEventListener('click', togglePanel);

// Chat functions
function initChat() {
  renderChatMessages();

  // Enable/disable send button based on input
  chatInput.addEventListener('input', () => {
    btnChatSend.disabled = !chatInput.value.trim() || isChatLoading;
    // Auto-resize textarea
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 96) + 'px';
  });

  // Send on Enter (without shift)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.value.trim() && !isChatLoading) {
        sendChatMessage(chatInput.value.trim());
      }
    }
  });

  // Send button
  btnChatSend.addEventListener('click', () => {
    if (chatInput.value.trim() && !isChatLoading) {
      sendChatMessage(chatInput.value.trim());
    }
  });

  // Clear button
  btnChatClear.addEventListener('click', clearChat);

  // Toggle button
  btnChatToggle.addEventListener('click', toggleChat);

  // Popout button
  btnChatPopout.addEventListener('click', popoutChat);

  // Conversation selector
  chatConversationSelect.addEventListener('change', () => {
    const value = chatConversationSelect.value;
    switchConversation(value || null);
  });

  // New conversation button
  btnChatNew.addEventListener('click', () => {
    chatConversationSelect.value = '';
    switchConversation(null);
  });

  // Listen for agent SSE events (tool calls, report updates, etc.)
  if (isElectron && window.electronAPI.agent?.onEvent) {
    window.electronAPI.agent.onEvent((event: { type: string; data: any }) => {
      handleAgentEvent(event);
    });
  }

  // Load conversation list
  loadConversations();
}

// Handle streaming agent events
function handleAgentEvent(event: { type: string; data?: any; [key: string]: any }) {
  // Normalize: event may have type at top level with other fields, or type + data
  const eventType = event.type;
  const data = event.data ?? event;

  switch (eventType) {
    case 'tool_call':
      // Tool is starting - add to current message's tool calls
      if (chatMessagesData.length > 0) {
        const lastMsg = chatMessagesData[chatMessagesData.length - 1];
        if (lastMsg.role === 'assistant') {
          if (!lastMsg.toolCalls) lastMsg.toolCalls = [];
          lastMsg.toolCalls.push({
            name: data.name || event.name,
            status: 'pending',
          });
          renderChatMessages();
        }
      }
      break;

    case 'tool_result':
      // Tool completed - update status
      if (chatMessagesData.length > 0) {
        const lastMsg = chatMessagesData[chatMessagesData.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.toolCalls) {
          const toolCall = lastMsg.toolCalls.find(tc => tc.name === (data.name || event.name) && tc.status === 'pending');
          if (toolCall) {
            toolCall.status = (data.success ?? event.success) ? 'success' : 'error';
            toolCall.duration = data.duration ?? event.duration;
            renderChatMessages();
          }
        }
      }
      break;

    case 'report_update':
      // Progressive report update - update assistant message content
      if (chatMessagesData.length > 0) {
        const lastMsg = chatMessagesData[chatMessagesData.length - 1];
        if (lastMsg.role === 'assistant') {
          lastMsg.content = data.report || event.report || '';
          lastMsg.isStreaming = true;
          renderChatMessages();
        }
      }
      break;

    case 'thinking':
      // Agent is thinking - could show in UI
      console.log('[Agent thinking]', data.content || event.content);
      break;

    case 'response':
      // Final response received
      if (chatMessagesData.length > 0) {
        const lastMsg = chatMessagesData[chatMessagesData.length - 1];
        if (lastMsg.role === 'assistant') {
          lastMsg.isStreaming = false;
          renderChatMessages();
        }
      }
      break;
  }
}

function renderChatMessages() {
  if (chatMessagesData.length === 0) {
    chatMessagesEl.innerHTML = `
      <div class="text-center text-gray-500 text-sm py-4">
        <p>Ask questions about your codebase</p>
        <p class="text-xs mt-1 text-gray-600">I can search, read files, and analyze code</p>
      </div>
    `;
    return;
  }

  chatMessagesEl.innerHTML = chatMessagesData.map((msg, idx) => {
    if (msg.role === 'user') {
      return `
        <div class="flex justify-end">
          <div class="max-w-[80%] bg-accent/20 text-gray-200 rounded-lg px-3 py-2 text-sm">
            ${escapeHtml(msg.content)}
          </div>
        </div>
      `;
    } else {
      // Assistant message
      const toolCallsHtml = msg.toolCalls?.length ? `
        <div class="flex flex-wrap gap-1 mb-2">
          ${msg.toolCalls.map(tc => `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
              tc.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
              tc.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
              'bg-red-500/20 text-red-400'
            }">
              ${tc.status === 'pending' ? '⏳' : tc.status === 'success' ? '✓' : '✗'}
              ${escapeHtml(tc.name)}
              ${tc.duration ? `<span class="text-gray-500">${tc.duration}ms</span>` : ''}
            </span>
          `).join('')}
        </div>
      ` : '';

      const streamingIndicator = msg.isStreaming ? `
        <span class="inline-block w-2 h-4 bg-accent animate-pulse ml-1"></span>
      ` : '';

      return `
        <div class="flex justify-start">
          <div class="max-w-[90%] bg-bg-panel border border-border rounded-lg px-3 py-2 text-sm">
            ${toolCallsHtml}
            <div class="prose prose-invert prose-sm max-w-none">
              ${formatMarkdown(msg.content)}${streamingIndicator}
            </div>
          </div>
        </div>
      `;
    }
  }).join('');

  // Scroll to bottom
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function formatMarkdown(text: string): string {
  // Simple markdown formatting
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code class="bg-black/30 px-1 rounded text-amber-400">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function addChatMessage(role: 'user' | 'assistant', content: string, toolCalls?: ChatMessageUI['toolCalls']) {
  chatMessagesData.push({
    role,
    content,
    timestamp: new Date(),
    toolCalls,
    isStreaming: role === 'assistant',
  });
  renderChatMessages();
}

function updateLastAssistantMessage(content: string, toolCalls?: ChatMessageUI['toolCalls'], isStreaming = true) {
  const lastMsg = chatMessagesData[chatMessagesData.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.content = content;
    if (toolCalls) lastMsg.toolCalls = toolCalls;
    lastMsg.isStreaming = isStreaming;
    renderChatMessages();
  }
}

async function sendChatMessage(message: string) {
  if (isChatLoading) return;

  // Add user message
  addChatMessage('user', message);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  btnChatSend.disabled = true;

  // Add placeholder assistant message
  addChatMessage('assistant', '', []);

  isChatLoading = true;

  try {
    // TODO: Phase 3/4 - Connect to daemon via IPC
    // For now, show a placeholder response
    if (isElectron && window.electronAPI.agent?.chat) {
      // Real implementation will use SSE streaming
      // Pass currentPath as cwd so agent works in the browsed directory
      const response = await window.electronAPI.agent.chat(message, currentConversationId, currentPath || initialCwd);

      if (response.conversationId) {
        currentConversationId = response.conversationId;
        // Update conversation selector to show current conversation
        chatConversationSelect.value = currentConversationId;
        // Refresh conversation list (new conversation may have been created)
        loadConversations();
      }

      // Update with real response
      updateLastAssistantMessage(
        response.content || 'No response received.',
        response.toolCalls?.map((tc: any) => ({
          name: tc.name,
          status: tc.success ? 'success' : 'error',
          duration: tc.duration,
        })),
        false
      );
    } else {
      // Placeholder for testing UI without daemon
      await new Promise(resolve => setTimeout(resolve, 500));
      updateLastAssistantMessage(
        'Chat with the Research Agent is not yet connected. This will be implemented in Phase 3 (daemon endpoint) and Phase 4 (IPC integration).\n\nFor now, you can use the file browser and search functionality.',
        [],
        false
      );
    }
  } catch (error: any) {
    console.error('Chat error:', error);
    updateLastAssistantMessage(
      `Error: ${error.message || 'Failed to communicate with agent'}`,
      [],
      false
    );
  } finally {
    isChatLoading = false;
    btnChatSend.disabled = !chatInput.value.trim();
  }
}

function clearChat() {
  chatMessagesData = [];
  currentConversationId = null;
  renderChatMessages();
}

function setChatHeight(height: number) {
  chatHeight = Math.max(MIN_CHAT_HEIGHT, Math.min(MAX_CHAT_HEIGHT, height));
  chatWrapper.style.height = `${chatHeight}px`;
}

function toggleChat() {
  chatCollapsed = !chatCollapsed;
  if (chatCollapsed) {
    chatWrapper.style.height = '32px';
    chatMessagesEl.style.display = 'none';
    chatInput.parentElement!.style.display = 'none';
    chatResizeHandle.style.display = 'none';
    btnChatToggle.textContent = '▲';
  } else {
    chatWrapper.style.height = `${chatHeight}px`;
    chatMessagesEl.style.display = '';
    chatInput.parentElement!.style.display = '';
    chatResizeHandle.style.display = '';
    btnChatToggle.textContent = '▼';
  }
}

function popoutChat() {
  if (isElectron && window.electronAPI.chat?.popOut) {
    // Pop out the chat window
    window.electronAPI.chat.popOut();
    // Hide chat panel in main window
    chatWrapper.style.display = 'none';
  } else {
    showToast('Pop-out window will be available in a future update');
  }
}

// Conversation management
interface ConversationListItem {
  id: string;
  title: string;
  createdAt: string;
  messageCount?: number;
}

async function loadConversations() {
  if (!isElectron || !window.electronAPI.agent?.listConversations) {
    return;
  }

  try {
    const conversations: ConversationListItem[] = await window.electronAPI.agent.listConversations();

    // Clear and rebuild select
    chatConversationSelect.innerHTML = '<option value="">New conversation</option>';

    for (const conv of conversations) {
      const option = document.createElement('option');
      option.value = conv.id;
      option.textContent = conv.title || `Conversation ${conv.id.slice(0, 8)}`;
      if (conv.messageCount) {
        option.textContent += ` (${conv.messageCount})`;
      }
      chatConversationSelect.appendChild(option);
    }

    // Select current conversation if any
    if (currentConversationId) {
      chatConversationSelect.value = currentConversationId;
    }
  } catch (error) {
    console.error('Failed to load conversations:', error);
  }
}

async function switchConversation(conversationId: string | null) {
  if (!conversationId) {
    // New conversation
    chatMessagesData = [];
    currentConversationId = null;
    renderChatMessages();
    return;
  }

  if (!isElectron || !window.electronAPI.agent?.getConversation) {
    return;
  }

  try {
    const conversation = await window.electronAPI.agent.getConversation(conversationId);
    currentConversationId = conversationId;

    // Load messages from conversation
    chatMessagesData = (conversation.messages || []).map((msg: any) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content || '',
      timestamp: new Date(msg.timestamp || Date.now()),
      toolCalls: msg.toolCalls?.map((tc: any) => ({
        name: tc.name,
        status: tc.success ? 'success' : 'error',
        duration: tc.duration,
      })),
      isStreaming: false,
    }));

    renderChatMessages();
  } catch (error) {
    console.error('Failed to load conversation:', error);
    showToast('Failed to load conversation');
  }
}

// Listen for chat popped back in (chat window closed)
if (isElectron && window.electronAPI.chat?.onPoppedIn) {
  window.electronAPI.chat.onPoppedIn(() => {
    // Show chat panel again
    chatWrapper.style.display = 'flex';
    if (chatCollapsed) {
      chatWrapper.style.height = '32px';
    } else {
      chatWrapper.style.height = `${chatHeight}px`;
    }
  });
}

// Chat resize
let isResizingChat = false;

chatResizeHandle.addEventListener('mousedown', (e) => {
  isResizingChat = true;
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (isResizingChat) {
    const wrapperRect = chatWrapper.getBoundingClientRect();
    const newHeight = wrapperRect.bottom - e.clientY;
    setChatHeight(newHeight);
  }
});

document.addEventListener('mouseup', () => {
  if (isResizingChat) {
    isResizingChat = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// Search functionality
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let isSearching = false;

interface SearchResultItem {
  type: 'semantic' | 'grep';
  file: string;
  line?: number;
  content?: string;
  match?: string;
  score?: number;
  name?: string;
  nodeType?: string;
  snippet?: string;
}

async function performSearch(query: string) {
  if (!query.trim()) {
    renderGrid();
    updateStatus();
    return;
  }

  if (!isElectron) {
    // Fallback for non-electron: simple filter
    const filtered = entries.filter(e =>
      e.name.toLowerCase().includes(query.toLowerCase())
    );
    renderSearchResultsFallback(filtered, query);
    return;
  }

  const indexedOnly = searchIndexedOnly.checked;

  // Show loading state
  isSearching = true;
  fileGrid.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-500">
    <div class="text-4xl mb-3 animate-pulse">🔍</div>
    <p class="text-sm">Searching...</p>
  </div>`;

  try {
    const result = await window.electronAPI.search.combined({
      query,
      basePath: currentPath,
      indexedOnly,
      limit: 50,
    });

    isSearching = false;

    if (result.error) {
      console.warn('Search warning:', result.error);
    }

    if (result.results.length === 0) {
      fileGrid.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-600">
        <div class="text-5xl mb-3 opacity-30">🔍</div>
        <p class="text-sm">No results for "${escapeHtml(query)}"</p>
        ${result.error ? `<p class="text-xs mt-2 text-amber-500/70">${escapeHtml(result.error)}</p>` : ''}
        ${indexedOnly ? '<p class="text-xs mt-1 text-gray-500">Try unchecking "Indexed" to search all files</p>' : ''}
      </div>`;
      statusItems.textContent = `No results`;
      return;
    }

    renderSearchResults(result.results, query, result.semanticCount, result.grepCount);
    statusItems.textContent = `${result.results.length} results (${result.semanticCount} indexed, ${result.grepCount} grep)`;
  } catch (error: any) {
    isSearching = false;
    console.error('Search error:', error);
    fileGrid.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-600">
      <div class="text-5xl mb-3 opacity-30">⚠️</div>
      <p class="text-sm text-red-400">Search failed</p>
      <p class="text-xs mt-1 text-gray-500">${escapeHtml(error.message || 'Unknown error')}</p>
    </div>`;
  }
}

function renderSearchResults(results: SearchResultItem[], query: string, semanticCount: number, grepCount: number) {
  fileGrid.innerHTML = `<div class="flex flex-col gap-1 p-2"></div>`;
  const container = fileGrid.firstElementChild!;

  // Header with stats
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-2 py-1 text-xs text-gray-500 border-b border-border mb-2';
  header.innerHTML = `
    <span class="font-medium text-gray-400">Results for "${escapeHtml(query)}"</span>
    <span class="flex-1"></span>
    ${semanticCount > 0 ? `<span class="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">${semanticCount} indexed</span>` : ''}
    ${grepCount > 0 ? `<span class="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">${grepCount} grep</span>` : ''}
  `;
  container.appendChild(header);

  for (const result of results) {
    const item = createSearchResultItem(result, query);
    container.appendChild(item);
  }
}

function createSearchResultItem(result: SearchResultItem, query: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'flex flex-col gap-1 px-3 py-2 rounded-lg hover:bg-bg-hover cursor-pointer transition-colors border border-transparent hover:border-border';

  const fileName = result.file.split('/').pop() || result.file;
  const relativePath = result.file.startsWith(currentPath)
    ? result.file.substring(currentPath.length + 1)
    : result.file;
  const dirPath = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';

  const ext = getFileExtension(fileName);
  const icon = getFileIcon(fileName, false);

  // Type badge
  const typeBadge = result.type === 'semantic'
    ? `<span class="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs shrink-0">indexed</span>`
    : `<span class="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs shrink-0">grep</span>`;

  // Score if available
  const scoreHtml = result.score !== undefined
    ? `<span class="text-xs text-gray-600">${(result.score * 100).toFixed(0)}%</span>`
    : '';

  // Line number if available
  const lineHtml = result.line
    ? `<span class="text-xs text-gray-500">:${result.line}</span>`
    : '';

  // Node type/name for semantic results
  const nodeInfoHtml = result.nodeType && result.name
    ? `<span class="text-xs text-purple-400 truncate max-w-32">${result.nodeType}: ${result.name}</span>`
    : '';

  // Snippet/content
  let snippetHtml = '';
  const snippetText = result.snippet || result.content;
  if (snippetText) {
    // Highlight the query in the snippet
    const highlighted = highlightMatch(snippetText, query);
    snippetHtml = `<div class="text-xs text-gray-500 truncate font-mono bg-black/20 px-2 py-1 rounded">${highlighted}</div>`;
  }

  item.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-lg shrink-0">${icon}</span>
      <span class="font-medium text-sm truncate text-gray-200">${escapeHtml(fileName)}</span>
      ${lineHtml}
      ${scoreHtml}
      <span class="flex-1"></span>
      ${nodeInfoHtml}
      ${typeBadge}
    </div>
    ${dirPath ? `<div class="text-xs text-gray-600 truncate pl-7">${escapeHtml(dirPath)}</div>` : ''}
    ${snippetHtml ? `<div class="pl-7">${snippetHtml}</div>` : ''}
  `;

  // Click to open file
  item.addEventListener('click', () => {
    openSearchResult(result);
  });

  // Double-click to open in editor
  item.addEventListener('dblclick', () => {
    if (isElectron) {
      window.electronAPI.fs.openWithEditor(result.file);
    }
  });

  return item;
}

function highlightMatch(text: string, query: string): string {
  const escaped = escapeHtml(text);
  const queryEscaped = escapeHtml(query);
  const regex = new RegExp(`(${queryEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<span class="text-amber-400 font-medium">$1</span>');
}

async function openSearchResult(result: SearchResultItem) {
  // Navigate to the directory containing the file
  const dirPath = result.file.substring(0, result.file.lastIndexOf('/'));
  if (dirPath !== currentPath) {
    await navigateTo(dirPath);
  }

  // Select the file in the grid
  const fileName = result.file.split('/').pop();
  const entry = entries.find(e => e.name === fileName);
  if (entry) {
    selectedEntries.clear();
    selectedEntries.add(entry.path);
    renderGrid();
    updateSelectionInfo();
  }

  // Clear search
  searchInput.value = '';
}

function renderSearchResultsFallback(filtered: FileEntry[], query: string) {
  if (filtered.length === 0) {
    fileGrid.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-600">
      <div class="text-5xl mb-3 opacity-30">🔍</div>
      <p class="text-sm">No results for "${escapeHtml(query)}"</p>
    </div>`;
    return;
  }

  if (viewMode === 'grid') {
    fileGrid.innerHTML = `<div class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2"></div>`;
    const grid = fileGrid.firstElementChild!;
    for (const entry of filtered) grid.appendChild(createGridItem(entry));
  } else {
    fileGrid.innerHTML = `<div class="flex flex-col gap-0.5"></div>`;
    const list = fileGrid.firstElementChild!;
    for (const entry of filtered) list.appendChild(createListItem(entry));
  }

  statusItems.textContent = `${filtered.length} results for "${query}"`;
}

searchInput.addEventListener('input', () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  // Longer debounce for API calls
  searchTimeout = setTimeout(() => {
    performSearch(searchInput.value);
  }, 400);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    renderGrid();
    updateStatus();
  } else if (e.key === 'Enter') {
    // Trigger search immediately on Enter
    if (searchTimeout) clearTimeout(searchTimeout);
    performSearch(searchInput.value);
  }
});

searchIndexedOnly.addEventListener('change', () => {
  if (searchInput.value) {
    performSearch(searchInput.value);
  }
});

// Check if this is chat-only mode (pop-out window)
const urlParams = new URLSearchParams(window.location.search);
const isChatMode = urlParams.get('mode') === 'chat';

// Init
async function init() {
  // Chat-only mode: Hide everything except chat
  if (isChatMode) {
    document.body.innerHTML = '';
    document.body.className = 'bg-bg-dark text-gray-300 h-screen overflow-hidden flex flex-col font-sans';
    document.body.innerHTML = `
      <div class="flex flex-col h-full">
        <!-- Chat header -->
        <div class="h-10 bg-bg-sidebar flex items-center px-4 gap-2 shrink-0 border-b border-border" style="-webkit-app-region: drag">
          <img src="./ragforge_logo.png" alt="RagForge" class="h-5 w-5 object-contain">
          <span class="text-sm font-medium text-gray-300">Research Assistant</span>
          <div class="flex-1"></div>
          <button id="btn-chat-clear-popout" class="text-xs text-gray-500 hover:text-gray-300 px-2" style="-webkit-app-region: no-drag">Clear</button>
        </div>
        <!-- Chat messages -->
        <div id="chat-messages-popout" class="flex-1 overflow-y-auto p-4 space-y-3 bg-bg-dark"></div>
        <!-- Chat input -->
        <div class="p-3 bg-bg-sidebar border-t border-border flex gap-2 shrink-0">
          <textarea id="chat-input-popout" placeholder="Ask a question..." rows="2" class="flex-1 px-3 py-2 text-sm bg-bg-dark border border-border rounded resize-none focus:border-accent focus:outline-none" style="-webkit-app-region: no-drag"></textarea>
          <button id="btn-chat-send-popout" class="px-4 py-2 bg-accent hover:bg-accent/80 text-white text-sm rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed shrink-0" disabled style="-webkit-app-region: no-drag">
            Send
          </button>
        </div>
      </div>
    `;

    initChatPopout();
    return;
  }

  renderIndexedItems();
  initChat();

  if (isElectron) {
    try {
      initialCwd = await window.electronAPI.fs.getCwd();
      homePath = await window.electronAPI.fs.getHomePath();

      const cwdName = initialCwd.split('/').pop() || 'Project';
      placeCwd.querySelector('span:last-child')!.textContent = cwdName;

      await navigateTo(initialCwd);
    } catch (error) {
      console.error('Init error:', error);
    }
  } else {
    initialCwd = '/home/user';
    homePath = '/home/user';
    await navigateTo(initialCwd);
  }
}

// Initialize chat in pop-out mode
async function initChatPopout() {
  const messagesEl = document.getElementById('chat-messages-popout')!;
  const inputEl = document.getElementById('chat-input-popout') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('btn-chat-send-popout') as HTMLButtonElement;
  const clearBtn = document.getElementById('btn-chat-clear-popout')!;

  // Get cwd for agent context
  let popoutCwd = '';
  if (isElectron) {
    try {
      popoutCwd = await window.electronAPI.fs.getCwd();
    } catch {}
  }

  // Render messages
  function renderMessages() {
    if (chatMessagesData.length === 0) {
      messagesEl.innerHTML = `
        <div class="text-center text-gray-500 text-sm py-8">
          <p>Ask questions about your codebase</p>
          <p class="text-xs mt-1 text-gray-600">I can search, read files, and analyze code</p>
        </div>
      `;
      return;
    }

    messagesEl.innerHTML = chatMessagesData.map(msg => {
      const isUser = msg.role === 'user';
      return `
        <div class="flex ${isUser ? 'justify-end' : 'justify-start'}">
          <div class="${isUser ? 'bg-accent/20 ml-8' : 'bg-bg-panel mr-8'} rounded-lg px-4 py-2 max-w-full">
            ${msg.toolCalls && msg.toolCalls.length > 0 ? `
              <div class="flex flex-wrap gap-1 mb-2">
                ${msg.toolCalls.map(tc => `
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                    tc.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                    tc.status === 'error' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-gray-400'
                  }">
                    ${tc.status === 'pending' ? '⏳' : tc.status === 'success' ? '✓' : '✗'} ${tc.name}
                    ${tc.duration ? `(${tc.duration}ms)` : ''}
                  </span>
                `).join('')}
              </div>
            ` : ''}
            <div class="text-sm whitespace-pre-wrap">${msg.content || (msg.isStreaming ? '...' : '')}</div>
          </div>
        </div>
      `;
    }).join('');

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Send message
  async function sendMessage() {
    const message = inputEl.value.trim();
    if (!message || isChatLoading) return;

    addChatMessage('user', message);
    inputEl.value = '';
    sendBtn.disabled = true;
    addChatMessage('assistant', '', []);
    isChatLoading = true;
    renderMessages();

    try {
      if (isElectron && window.electronAPI.agent?.chat) {
        const response = await window.electronAPI.agent.chat(message, currentConversationId, popoutCwd);
        if (response.conversationId) currentConversationId = response.conversationId;
        updateLastAssistantMessage(response.content || 'No response.', response.toolCalls?.map((tc: any) => ({
          name: tc.name,
          status: tc.success ? 'success' : 'error',
          duration: tc.duration,
        })), false);
      }
    } catch (error: any) {
      updateLastAssistantMessage(`Error: ${error.message}`, [], false);
    } finally {
      isChatLoading = false;
      sendBtn.disabled = !inputEl.value.trim();
      renderMessages();
    }
  }

  // Event listeners
  inputEl.addEventListener('input', () => {
    sendBtn.disabled = !inputEl.value.trim() || isChatLoading;
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  clearBtn.addEventListener('click', () => {
    chatMessagesData = [];
    currentConversationId = null;
    renderMessages();
  });

  // Listen for agent events
  if (isElectron && window.electronAPI.agent?.onEvent) {
    window.electronAPI.agent.onEvent((event: { type: string; data: any }) => {
      handleAgentEvent(event);
      renderMessages();
    });
  }

  renderMessages();
}

// Cleanup on window close
window.addEventListener('beforeunload', () => {
  cleanupThreeJS();
});

init();
