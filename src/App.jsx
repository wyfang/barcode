import {
  Button,
  ColorField,
  ColorSwatch,
  Drawer,
  Label,
  ListBox,
  Modal,
  NumberField,
  Select,
  Slider,
  Surface,
  Switch,
  Table,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
  parseColor,
  toast,
} from "@heroui/react";
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  HelpCircle,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Share2,
  Smartphone,
  Trash2,
  UploadCloud,
  WifiOff,
} from "lucide-react";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  DEFAULT_SETTINGS,
  downloadRecord,
  downloadRecords,
  parseBarcodeInput,
} from "./barcode.js";
import {
  analyzeExcelColumn,
  configureSheet,
  readExcelFile,
} from "./excel.js";

const THEME_ORDER = ["system", "light", "dark"];
const ENTER_ACTIONS = ["newline", "download"];
const DOWNLOAD_RECORD_TTL = 60_000;
const DOWNLOAD_RECORD_REMOVE_GRACE = 300;
const PREVIEW_SETTLE_DELAY = 160;
const PREVIEW_TRANSITION_DURATION = 220;
const RECENT_DOWNLOADS_KEY = "barcode-recent-downloads-v1";
const PREFERENCES_KEY = "barcode-workbench-preferences-v1";

function createRecordInstanceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStoredPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function updateStoredPreferences(next) {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...readStoredPreferences(), ...next }),
    );
  } catch {
    // The workbench remains usable when storage is unavailable.
  }
}

function readRecentDownloads() {
  try {
    const now = Date.now();
    const items = JSON.parse(sessionStorage.getItem(RECENT_DOWNLOADS_KEY) || "[]");
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.recordId === "string" &&
        typeof item.value === "string" &&
        typeof item.format === "string" &&
        typeof item.downloadedAt === "string" &&
        Number.isFinite(item.downloadedAtMs) &&
        Number.isFinite(item.expiresAt) &&
        item.expiresAt > now,
    );
  } catch {
    return [];
  }
}

function downloadRecordStyle(item) {
  const age = Math.min(
    DOWNLOAD_RECORD_TTL,
    Math.max(0, Date.now() - item.downloadedAtMs),
  );
  return { "--download-record-delay": `-${age}ms` };
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function storedColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}

function readGeneratorPreferences() {
  const stored = readStoredPreferences();
  const barcode =
    stored.barcode && typeof stored.barcode === "object" ? stored.barcode : {};
  const displayValue =
    typeof barcode.displayValue === "boolean"
      ? barcode.displayValue
      : DEFAULT_SETTINGS.displayValue;
  const exportHeightCm = boundedNumber(
    barcode.exportHeightCm ??
      (Number.isFinite(Number(barcode.exportHeight))
        ? (Number(barcode.exportHeight) / 300) * 2.54
        : undefined),
    1,
    10,
    DEFAULT_SETTINGS.exportHeightCm,
  );
  const exportWidthCm = boundedNumber(
    barcode.exportWidthCm,
    3,
    20,
    DEFAULT_SETTINGS.exportWidthCm,
  );
  const fontSize = boundedNumber(
    barcode.fontSize,
    10,
    36,
    DEFAULT_SETTINGS.fontSize,
  );

  return {
    clearAfterDownload: stored.clearAfterDownload === true,
    enterAction: ENTER_ACTIONS.includes(stored.enterAction)
      ? stored.enterAction
      : "newline",
    excludeDuplicates: stored.excludeDuplicates === true,
    settings: {
      ...DEFAULT_SETTINGS,
      background: storedColor(barcode.background, DEFAULT_SETTINGS.background),
      displayValue,
      exportHeightCm,
      exportWidthCm,
      fontSize,
      lineColor: storedColor(barcode.lineColor, DEFAULT_SETTINGS.lineColor),
    },
  };
}

function applyTheme(preference) {
  const resolved =
    preference === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector("#theme-color")
    ?.setAttribute("content", resolved === "dark" ? "#050505" : "#f4f4f5");
  return resolved;
}

function useThemePreference() {
  const [theme, setThemeState] = useState(
    () => {
      const saved =
        readStoredPreferences().theme ||
        localStorage.getItem("barcode-theme") ||
        "system";
      return THEME_ORDER.includes(saved) ? saved : "system";
    },
  );
  const [resolvedTheme, setResolvedTheme] = useState(() => applyTheme(theme));

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") setResolvedTheme(applyTheme("system"));
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = (nextTheme) => {
    localStorage.setItem("barcode-theme", nextTheme);
    updateStoredPreferences({ theme: nextTheme });
    setThemeState(nextTheme);
    setResolvedTheme(applyTheme(nextTheme));
  };

  return { resolvedTheme, setTheme, theme };
}

function ThemeTabs() {
  const { setTheme, theme } = useThemePreference();
  return (
    <ToggleButtonGroup
      aria-label="界面主题"
      className="theme-tabs"
      disallowEmptySelection
      selectedKeys={new Set([theme])}
      selectionMode="single"
      size="sm"
      onSelectionChange={(keys) => {
        const nextTheme = [...keys][0];
        if (nextTheme) setTheme(String(nextTheme));
      }}
    >
      <ToggleButton id="system">自动</ToggleButton>
      <ToggleButton id="light">亮色</ToggleButton>
      <ToggleButton id="dark">暗色</ToggleButton>
    </ToggleButtonGroup>
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    addEventListener("online", goOnline);
    addEventListener("offline", goOffline);
    return () => {
      removeEventListener("online", goOnline);
      removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

function isStandalone() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOSDevice() {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());
  const ios = isIOSDevice();
  const mobile = ios || /Android/i.test(navigator.userAgent);

  useEffect(() => {
    const beforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const appInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      toast.success("已添加到主屏幕");
    };
    addEventListener("beforeinstallprompt", beforeInstall);
    addEventListener("appinstalled", appInstalled);
    return () => {
      removeEventListener("beforeinstallprompt", beforeInstall);
      removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  if (installed || (!mobile && !deferredPrompt)) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setGuideOpen(true);
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") toast.success("正在安装条码工作台");
    setDeferredPrompt(null);
  };

  return (
    <>
      <Button
        isIconOnly
        aria-label="安装应用"
        className="bar-action"
        size="sm"
        title="安装应用"
        variant="tertiary"
        onPress={handleInstall}
      >
        <Smartphone aria-hidden="true" size={16} />
      </Button>

      <Drawer.Backdrop isOpen={guideOpen} onOpenChange={setGuideOpen}>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog className="compact-drawer install-drawer">
            <Drawer.Handle />
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>
                {ios ? "添加到 iPhone / iPad 主屏幕" : "安装条码工作台"}
              </Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              {ios ? (
                <ol className="instruction-list">
                  <li>
                    点击 <Share2 size={16} /> <strong>分享</strong>
                  </li>
                  <li>选择“添加到主屏幕”</li>
                  <li>确认“作为网页 App 打开”并添加</li>
                </ol>
              ) : (
                <ol className="instruction-list">
                  <li>打开浏览器菜单</li>
                  <li>选择“安装应用”或“添加到主屏幕”</li>
                </ol>
              )}
            </Drawer.Body>
            <Drawer.Footer>
              <Button fullWidth slot="close" variant="secondary">
                完成
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}

function PwaLifecycle() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("PWA registration failed", error);
    },
  });

  useEffect(() => {
    if (offlineReady) setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh) return null;

  return (
    <aside className="update-banner" role="status">
      <RefreshCw aria-hidden="true" size={15} />
      <span>发现新版本</span>
      <Button size="sm" onPress={() => updateServiceWorker(true)}>
        更新
      </Button>
      <Button
        isIconOnly
        aria-label="稍后更新"
        size="sm"
        variant="ghost"
        onPress={() => setNeedRefresh(false)}
      >
        ×
      </Button>
    </aside>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {[3, 1, 4, 2, 1, 3, 2].map((width, index) => (
        <i key={`${width}-${index}`} style={{ width }} />
      ))}
    </span>
  );
}

function HelpDrawer({ isOpen, onOpenChange }) {
  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="compact-drawer help-drawer">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>使用说明</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="help-body">
            <section>
              <h3>快速生成</h3>
              <ul>
                <li>一行一个编号，输入或粘贴后自动生成 CODE128。</li>
                <li>单条可下载 PNG 或 SVG；多条会逐个下载 PNG。</li>
                <li>浏览器首次批量下载时，可能需要允许多个文件。</li>
                <li>重复项默认保留，可在“属性”中排除。</li>
                <li>不支持的字符会留在列表中，但不会进入下载。</li>
              </ul>
            </section>
            <section>
              <h3>快捷操作</h3>
              <dl className="shortcut-list">
                <div>
                  <dt>下载</dt>
                  <dd>⌘ / Ctrl + Enter</dd>
                </div>
                <div>
                  <dt>下载后清空输入</dt>
                  <dd>下载完成后清空并重新聚焦输入框</dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Excel 导入</h3>
              <ul>
                <li>支持 .xls 与 .xlsx，文件只在本机浏览器中解析。</li>
                <li>导入后可切换工作表、表头行和编号列，并预览数据。</li>
                <li>在输入区打开 Excel，确认后会把有效编号直接填入输入框。</li>
                <li>Excel 内容不会写入本地设置，也不会上传服务器。</li>
              </ul>
            </section>
            <section>
              <h3>隐私与离线</h3>
              <ul>
                <li>条码内容只在本机浏览器中处理。</li>
                <li>安装到主屏幕后可像 App 一样打开，并支持离线生成。</li>
              </ul>
            </section>
          </Drawer.Body>
          <Drawer.Footer>
            <Button fullWidth slot="close" variant="secondary">
              关闭
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function usePreviewLayers(record) {
  const signature = record?.svg || "";
  const [layers, setLayers] = useState({ current: record, previous: null });

  useEffect(() => {
    const delay = record ? PREVIEW_SETTLE_DELAY : 0;
    const timeoutId = window.setTimeout(() => {
      setLayers((current) => {
        if ((current.current?.svg || "") === signature) return current;
        return { current: record, previous: current.current };
      });
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [record, signature]);

  useEffect(() => {
    if (!layers.previous) return undefined;
    const timeoutId = window.setTimeout(() => {
      setLayers((current) => ({ ...current, previous: null }));
    }, PREVIEW_TRANSITION_DURATION);
    return () => window.clearTimeout(timeoutId);
  }, [layers.current?.svg, layers.previous]);

  return layers;
}

function PreviewBarcodeLayer({ className, record }) {
  if (!record) return null;

  return (
    <div className={`preview-content ${className}`}>
      <div
        className="barcode-svg"
        aria-label={`条码预览：${record.value}`}
        dangerouslySetInnerHTML={{ __html: record.svg }}
      />
    </div>
  );
}

function usePreviewViewport(aspectRatio) {
  const containerRef = useRef(null);
  const [size, setSize] = useState(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateSize = () => {
      const availableWidth = Math.min(container.clientWidth, 760);
      const availableHeight = Math.min(container.clientHeight, 360);
      if (!(availableWidth > 0) || !(availableHeight > 0)) return;

      let width = availableWidth;
      let height = width / aspectRatio;
      if (height > availableHeight) {
        height = availableHeight;
        width = height * aspectRatio;
      }

      setSize((current) => {
        if (
          current &&
          Math.abs(current.width - width) < 0.5 &&
          Math.abs(current.height - height) < 0.5
        ) {
          return current;
        }
        return { height, width };
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [aspectRatio]);

  return { containerRef, size };
}

function BarcodePreview({ aspectRatio, record }) {
  const layers = usePreviewLayers(record);
  const normalizedAspectRatio = boundedNumber(aspectRatio, 0.3, 20, 2);
  const { containerRef, size } = usePreviewViewport(normalizedAspectRatio);

  return (
    <div className="preview-frame" ref={containerRef}>
      <div
        className="preview-viewport"
        data-ready={size ? "true" : "false"}
        style={size ? { height: size.height, width: size.width } : undefined}
      >
        {layers.previous && (
          <PreviewBarcodeLayer
            className="is-leaving"
            key={`previous-${layers.previous.svg}`}
            record={layers.previous}
          />
        )}
        {layers.current ? (
          <PreviewBarcodeLayer
            className="is-entering"
            key={`current-${layers.current.svg}`}
            record={layers.current}
          />
        ) : (
          <div className="preview-empty">
            <div className="empty-barcode" aria-hidden="true">
              {[2, 5, 3, 2, 7, 3, 5, 2, 4, 6, 2, 3].map((width, index) => (
                <i key={`${width}-${index}`} style={{ width }} />
              ))}
            </div>
            <span>等待输入</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingControl({ label, value, children }) {
  return (
    <div className="setting-control">
      <div className="setting-label">
        <span>{label}</span>
        {value !== undefined && <strong>{value}</strong>}
      </div>
      {children}
    </div>
  );
}

function CompactNumberField({
  ariaLabel,
  isDisabled = false,
  maxValue,
  minValue,
  onChange,
  step = 1,
  unit,
  value,
}) {
  return (
    <NumberField
      fullWidth
      aria-label={ariaLabel}
      className="compact-number-field"
      isDisabled={isDisabled}
      maxValue={maxValue}
      minValue={minValue}
      step={step}
      value={value}
      variant="secondary"
      onChange={(next) => {
        if (Number.isFinite(next)) onChange(next);
      }}
    >
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input />
        {unit && <span className="number-unit">{unit}</span>}
        <NumberField.IncrementButton />
      </NumberField.Group>
    </NumberField>
  );
}

function ColorSetting({ ariaLabel, value, onChange }) {
  const color = parseColor(value);
  return (
    <ColorField
      fullWidth
      aria-label={ariaLabel}
      className="compact-color-field"
      value={color}
      onChange={(nextColor) => onChange(nextColor.toString("hex"))}
    >
      <ColorField.Group fullWidth variant="secondary">
        <ColorField.Prefix>
          <ColorSwatch aria-label={`${ariaLabel}预览`} color={color} shape="square" size="sm" />
        </ColorField.Prefix>
        <ColorField.Input />
      </ColorField.Group>
    </ColorField>
  );
}

function InspectorControls({
  clearAfterDownload,
  excludeDuplicates,
  onClearAfterDownloadChange,
  onExcludeDuplicatesChange,
  onSettingsChange,
  settings,
}) {
  return (
    <div className="inspector-controls">
      <section className="inspector-section">
        <Slider
          aria-label="条码宽度（厘米）"
          className="inspector-slider"
          maxValue={20}
          minValue={3}
          step={0.1}
          value={settings.exportWidthCm}
          onChange={(value) => onSettingsChange({ exportWidthCm: Number(value) })}
        >
          <Label>条码宽度</Label>
          <Slider.Output>{settings.exportWidthCm.toFixed(1)} cm</Slider.Output>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <Slider
          aria-label="条码高度（厘米）"
          className="inspector-slider"
          maxValue={10}
          minValue={1}
          step={0.1}
          value={settings.exportHeightCm}
          onChange={(value) => onSettingsChange({ exportHeightCm: Number(value) })}
        >
          <Label>条码高度</Label>
          <Slider.Output>{settings.exportHeightCm.toFixed(1)} cm</Slider.Output>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <SettingControl
          label="文字大小"
          value={settings.displayValue ? undefined : "已隐藏"}
        >
          <CompactNumberField
            ariaLabel="条码文字大小"
            isDisabled={!settings.displayValue}
            maxValue={36}
            minValue={10}
            value={settings.fontSize}
            onChange={(fontSize) => onSettingsChange({ fontSize })}
          />
        </SettingControl>
        <div className="setting-grid">
          <SettingControl label="条码颜色">
            <ColorSetting
              ariaLabel="条码颜色"
              value={settings.lineColor}
              onChange={(lineColor) => onSettingsChange({ lineColor })}
            />
          </SettingControl>
          <SettingControl label="背景颜色">
            <ColorSetting
              ariaLabel="背景颜色"
              value={settings.background}
              onChange={(background) => onSettingsChange({ background })}
            />
          </SettingControl>
        </div>
        <Switch
          isSelected={settings.displayValue}
          size="sm"
          onChange={(selected) => onSettingsChange({ displayValue: selected })}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            显示编号文字
          </Switch.Content>
        </Switch>
      </section>

      <section className="inspector-section">
        <div className="settings-switches">
          <Switch
            isSelected={clearAfterDownload}
            size="sm"
            onChange={onClearAfterDownloadChange}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              下载后清空输入
            </Switch.Content>
          </Switch>
          <Switch
            isSelected={excludeDuplicates}
            size="sm"
            onChange={onExcludeDuplicatesChange}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              批量时排除重复项
            </Switch.Content>
          </Switch>
        </div>
      </section>
    </div>
  );
}

function QuickGenerator() {
  const [initialPreferences] = useState(readGeneratorPreferences);
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState(initialPreferences.settings);
  const [clearAfterDownload, setClearAfterDownload] = useState(
    initialPreferences.clearAfterDownload,
  );
  const [enterAction, setEnterAction] = useState(initialPreferences.enterAction);
  const [excludeDuplicates, setExcludeDuplicates] = useState(
    initialPreferences.excludeDuplicates,
  );
  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentDownloads, setRecentDownloads] = useState(readRecentDownloads);
  const [hiddenDownloadedIds, setHiddenDownloadedIds] = useState(() => new Set());
  const inputRef = useRef(null);

  useEffect(() => {
    updateStoredPreferences({
      barcode: settings,
      clearAfterDownload,
      enterAction,
      excludeDuplicates,
    });
  }, [clearAfterDownload, enterAction, excludeDuplicates, settings]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        RECENT_DOWNLOADS_KEY,
        JSON.stringify(recentDownloads),
      );
    } catch {
      // Download history remains available in memory when session storage is unavailable.
    }
  }, [recentDownloads]);

  useEffect(() => {
    if (!recentDownloads.length) return undefined;
    const nextExpiry = Math.min(...recentDownloads.map((item) => item.expiresAt));
    const timeoutId = window.setTimeout(() => {
      const now = Date.now();
      setRecentDownloads((current) =>
        current.filter((item) => item.expiresAt > now),
      );
    }, Math.max(0, nextExpiry - Date.now()) + DOWNLOAD_RECORD_REMOVE_GRACE);
    return () => window.clearTimeout(timeoutId);
  }, [recentDownloads]);

  const records = useMemo(() => parseBarcodeInput(input, settings), [input, settings]);
  const visibleRecords = useMemo(
    () => records.filter((record) => !hiddenDownloadedIds.has(record.id)),
    [hiddenDownloadedIds, records],
  );
  const validRecords = useMemo(() => records.filter((record) => record.valid), [records]);
  const visibleValidRecords = useMemo(
    () => visibleRecords.filter((record) => record.valid),
    [visibleRecords],
  );
  const selectedRecord =
    visibleValidRecords.find((record) => record.id === selectedId) ||
    visibleValidRecords.at(-1) ||
    null;

  const downloadableRecords = useMemo(() => {
    if (!excludeDuplicates) return visibleValidRecords;
    const seen = new Set();
    return visibleValidRecords.filter((record) => {
      if (seen.has(record.value)) return false;
      seen.add(record.value);
      return true;
    });
  }, [excludeDuplicates, visibleValidRecords]);

  useEffect(() => {
    setSelectedId(validRecords.at(-1)?.id || null);
  }, [input]);

  useEffect(() => {
    const nextId = selectedRecord?.id || null;
    if (selectedId !== nextId) setSelectedId(nextId);
  }, [selectedId, selectedRecord]);

  const finishDownload = () => {
    window.setTimeout(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      if (clearAfterDownload) {
        setInput("");
        setSelectedId(null);
        setHiddenDownloadedIds(new Set());
      }
      else inputRef.current.select();
    }, 80);
  };

  const rememberDownloads = (downloadedRecords, format) => {
    const downloadedAtMs = Date.now();
    const downloadedAt = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
    });
    const entries = downloadedRecords
      .slice()
      .reverse()
      .map((record) => ({
        downloadedAt,
        downloadedAtMs,
        expiresAt: downloadedAtMs + DOWNLOAD_RECORD_TTL,
        format: format.toUpperCase(),
        id: createRecordInstanceId(),
        recordId: record.id,
        value: record.value,
      }));
    const downloadedRecordIds = entries.map((item) => item.recordId);
    setHiddenDownloadedIds((current) =>
      new Set([...current, ...downloadedRecordIds]),
    );
    setRecentDownloads((current) => [
      ...entries,
      ...current.filter((item) => item.expiresAt > downloadedAtMs),
    ]);
  };

  const exportOne = async (format, remember = true) => {
    if (!selectedRecord || exporting) return;
    setExporting(true);
    try {
      const filename = await downloadRecord(
        selectedRecord,
        format,
        settings.exportHeightCm,
        settings.exportWidthCm,
      );
      if (remember) rememberDownloads([selectedRecord], format);
      toast.success("已下载", { description: filename });
      finishDownload();
    } catch (error) {
      toast.danger("下载失败", { description: error.message });
    } finally {
      setExporting(false);
    }
  };

  const exportAll = async (remember = true) => {
    if (!downloadableRecords.length || exporting) return;
    setExporting(true);
    try {
      const filenames = await downloadRecords(
        downloadableRecords,
        settings.exportHeightCm,
        settings.exportWidthCm,
      );
      if (remember) rememberDownloads(downloadableRecords, "png");
      toast.success("已发起批量下载", {
        description: `${filenames.length} 个 PNG`,
      });
      finishDownload();
    } catch (error) {
      toast.danger("批量下载失败", { description: error.message });
    } finally {
      setExporting(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) {
        toast.warning("剪贴板为空");
        return;
      }
      setInput(value);
      setSelectedId(null);
      setHiddenDownloadedIds(new Set());
      inputRef.current?.focus();
    } catch {
      toast.warning("请使用 ⌘/Ctrl + V");
      inputRef.current?.focus();
    }
  };

  const loadExcelValues = (payload) => {
    setInput(payload.values.join("\n"));
    setSelectedId(null);
    setHiddenDownloadedIds(new Set());
    toast.success("Excel 数据已载入", {
      description: `${payload.values.length} 个编号`,
    });
    window.setTimeout(() => inputRef.current?.focus(), 80);
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const shortcutDownload = event.metaKey || event.ctrlKey;
    const directDownload = enterAction === "download" && !event.shiftKey;
    if (shortcutDownload || directDownload) {
      event.preventDefault();
      if (visibleValidRecords.length > 1) exportAll();
      else exportOne("png");
    }
  };

  const changeSettings = (next) =>
    setSettings((current) => ({ ...current, ...next }));

  return (
    <>
      <div className="quick-workspace">
      <Surface className="dock-panel input-dock">
        <header className="dock-header">
          <strong>输入</strong>
          <span>{records.length ? `${validRecords.length}/${records.length}` : "0"}</span>
        </header>

        <div className="input-zone">
          <TextArea
            ref={inputRef}
            fullWidth
            aria-label="编号内容"
            className="barcode-input"
            placeholder="一行一个编号"
            rows={5}
            value={input}
            variant="secondary"
            onChange={(event) => {
              setInput(event.target.value);
              setSelectedId(null);
              setHiddenDownloadedIds(new Set());
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="input-actions">
            <div className="input-edit-actions">
              <Button size="sm" variant="secondary" onPress={pasteFromClipboard}>
                <ClipboardPaste size={15} />
                粘贴
              </Button>
              <Button size="sm" variant="secondary" onPress={() => setExcelOpen(true)}>
                <FileSpreadsheet size={14} />
                Excel
              </Button>
              <Button
                isDisabled={!input}
                size="sm"
                variant="ghost"
                onPress={() => {
                  setInput("");
                  setSelectedId(null);
                  setHiddenDownloadedIds(new Set());
                  inputRef.current?.focus();
                }}
              >
                <Trash2 size={14} />
                清空
              </Button>
            </div>
            <div className="enter-action">
              <ToggleButtonGroup
                aria-label="回车键行为"
                disallowEmptySelection
                selectedKeys={new Set([enterAction])}
                selectionMode="single"
                size="sm"
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (ENTER_ACTIONS.includes(String(next))) setEnterAction(String(next));
                }}
              >
                <ToggleButton id="newline">回车换行</ToggleButton>
                <ToggleButton id="download" title="Shift + Enter 仍可换行">
                  <ToggleButtonGroup.Separator />
                  回车下载
                </ToggleButton>
              </ToggleButtonGroup>
            </div>
          </div>
        </div>

        <div className="record-list" aria-label="条码记录列表" aria-live="polite">
          {!visibleRecords.length && !recentDownloads.length && (
            <span className="records-empty">
              {records.length ? "已全部处理" : "等待编号"}
            </span>
          )}
          {[...visibleRecords].reverse().map((record) => {
            return (
              <div
                className={`record-row ${selectedRecord?.id === record.id ? "is-selected" : ""} ${!record.valid ? "is-invalid" : ""}`}
                key={record.id}
              >
                <Button
                  className="record-select-button"
                  isDisabled={!record.valid}
                  variant="ghost"
                  onPress={() => setSelectedId(record.id)}
                >
                  <span className="record-index">
                    {record.index + 1}
                  </span>
                  <span className="record-text">
                    <strong title={record.value}>{record.value}</strong>
                    <small>{record.error || (record.duplicate ? "重复" : "就绪")}</small>
                  </span>
                </Button>
                {record.valid && (
                  <Button
                    isIconOnly
                    aria-label={`下载 ${record.value}`}
                    className="record-download-button"
                    size="sm"
                    variant="ghost"
                    onPress={async () => {
                      try {
                        const filename = await downloadRecord(
                          record,
                          "png",
                          settings.exportHeightCm,
                          settings.exportWidthCm,
                        );
                        rememberDownloads([record], "png");
                        toast.success("已下载", { description: filename });
                      } catch (error) {
                        toast.danger("下载失败", { description: error.message });
                      }
                    }}
                  >
                    <Download size={14} />
                  </Button>
                )}
              </div>
            );
          })}
          {recentDownloads.map((item) => (
            <div
              className="record-row is-downloaded is-archived-download"
              key={item.id}
              style={downloadRecordStyle(item)}
            >
              <div className="archived-download-content">
                <span className="record-index">
                  <Check aria-hidden="true" size={13} />
                </span>
                <span className="record-text">
                  <strong title={item.value}>{item.value}</strong>
                  <small>已下载 · {item.format} · {item.downloadedAt}</small>
                </span>
              </div>
            </div>
          ))}
        </div>
      </Surface>

      <Surface className="dock-panel canvas-dock">
        <header className="dock-header canvas-header">
          <strong>预览</strong>
          <div>
            {selectedRecord && (
              <span title={selectedRecord.value}>
                {selectedRecord.index + 1} · {selectedRecord.value}
              </span>
            )}
            <Button
              isIconOnly
              aria-label="打开属性"
              className="mobile-settings-button"
              size="sm"
              variant="ghost"
              onPress={() => setSettingsOpen(true)}
            >
              <Settings2 size={15} />
            </Button>
          </div>
        </header>
        <div className="canvas-stage">
          <div className="preview-paper">
            <BarcodePreview
              aspectRatio={settings.exportWidthCm / settings.exportHeightCm}
              record={selectedRecord}
            />
          </div>
        </div>
        <footer className="export-bar">
          {visibleValidRecords.length > 1 && (
            <Button
              isDisabled={!downloadableRecords.length}
              isPending={exporting}
              size="sm"
              onPress={() => exportAll()}
            >
              <Download size={15} />
              下载全部 ({downloadableRecords.length})
            </Button>
          )}
          <div className="download-format-actions">
            <Button
              isDisabled={!selectedRecord}
              isPending={exporting}
              size="sm"
              variant={visibleValidRecords.length > 1 ? "secondary" : "primary"}
              onPress={() => exportOne("png")}
            >
              <Download size={15} />
              PNG
            </Button>
            <Button
              isDisabled={!selectedRecord || exporting}
              size="sm"
              variant="secondary"
              onPress={() => exportOne("svg")}
            >
              SVG
            </Button>
          </div>
          <span className="shortcut-hint">
            {enterAction === "download"
              ? "Enter 下载 · Shift + Enter 换行"
              : "⌘ / Ctrl + Enter 下载"}
          </span>
        </footer>
      </Surface>

      <Surface className="dock-panel inspector-dock">
        <header className="dock-header">
          <strong>属性</strong>
        </header>
        <div className="inspector-scroll">
          <InspectorControls
            clearAfterDownload={clearAfterDownload}
            excludeDuplicates={excludeDuplicates}
            settings={settings}
            onClearAfterDownloadChange={setClearAfterDownload}
            onExcludeDuplicatesChange={setExcludeDuplicates}
            onSettingsChange={changeSettings}
          />
        </div>
      </Surface>

      <Drawer.Backdrop isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="compact-drawer mobile-settings-drawer">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>属性</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <InspectorControls
                clearAfterDownload={clearAfterDownload}
                excludeDuplicates={excludeDuplicates}
                settings={settings}
                onClearAfterDownloadChange={setClearAfterDownload}
                onExcludeDuplicatesChange={setExcludeDuplicates}
                onSettingsChange={changeSettings}
              />
            </Drawer.Body>
            <Drawer.Footer>
              <Button fullWidth slot="close">
                完成
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
      </div>
      <ExcelImportModal
        isOpen={excelOpen}
        onLoadValues={loadExcelValues}
        onOpenChange={setExcelOpen}
      />
    </>
  );
}

function CompactSelect({ className = "", label, options, value, onChange }) {
  return (
    <Select
      fullWidth
      aria-label={label}
      className={`compact-select ${className}`}
      placeholder="请选择"
      value={String(value)}
      variant="secondary"
      onChange={(key) => onChange(String(key))}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={String(option.id)}
              textValue={option.label}
            >
              <span className="select-option-text">{option.label}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ExcelImportModal({ isOpen, onLoadValues, onOpenChange }) {
  const [workbook, setWorkbook] = useState(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [columnIndex, setColumnIndex] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const sheet = workbook?.sheets[sheetIndex] || null;
  const configured = useMemo(
    () => (sheet ? configureSheet(sheet, headerRow, columnIndex) : null),
    [columnIndex, headerRow, sheet],
  );
  const analysis = useMemo(
    () =>
      sheet && configured
        ? analyzeExcelColumn(sheet, configured.headerRow, configured.columnIndex)
        : null,
    [configured, sheet],
  );

  const loadFile = async (file) => {
    if (!file || parsing) return;
    setParsing(true);
    try {
      const nextWorkbook = await readExcelFile(file);
      const firstSheet = nextWorkbook.sheets[0];
      setWorkbook(nextWorkbook);
      setSheetIndex(0);
      setHeaderRow(firstSheet.suggestedHeaderRow);
      setColumnIndex(firstSheet.suggestedColumn);
      toast.success("Excel 已读取", {
        description: `${nextWorkbook.sheets.length} 个工作表`,
      });
    } catch (error) {
      toast.danger("无法读取 Excel", { description: error.message });
    } finally {
      setParsing(false);
    }
  };

  const chooseSheet = (key) => {
    const nextIndex = Number(key);
    const nextSheet = workbook.sheets[nextIndex];
    setSheetIndex(nextIndex);
    setHeaderRow(nextSheet.suggestedHeaderRow);
    setColumnIndex(nextSheet.suggestedColumn);
  };

  const chooseHeaderRow = (oneBasedRow) => {
    if (!sheet) return;
    const next = configureSheet(sheet, oneBasedRow - 1, columnIndex);
    const suggested =
      next.headers.find((header) =>
        /邮件号|运单|单号|编号|条码|barcode|tracking/i.test(header.name),
      ) || next.headers[next.columnIndex];
    setHeaderRow(next.headerRow);
    setColumnIndex(suggested?.index || 0);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      hidden
      accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      type="file"
      onChange={(event) => {
        loadFile(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );

  const confirmImport = () => {
    if (!workbook || !sheet || !configured || !analysis?.validCount) return;
    onLoadValues({
      columnName: configured.headers[configured.columnIndex]?.name,
      fileName: workbook.fileName,
      sheetName: sheet.name,
      values: analysis.values,
    });
    onOpenChange(false);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="center" scroll="inside" size="lg">
        <Modal.Dialog className="excel-import-dialog">
          <Modal.CloseTrigger />
          <Modal.Header className="excel-modal-header">
            <Modal.Icon className="excel-modal-icon">
              <FileSpreadsheet size={17} />
            </Modal.Icon>
            <Modal.Heading>导入 Excel</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="excel-modal-body">
            {!workbook ? (
              <div
                className="excel-dropzone excel-modal-dropzone"
                data-dragging={dragging || undefined}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                {parsing ? (
                  <LoaderCircle className="excel-spinner" size={28} />
                ) : (
                  <UploadCloud size={28} />
                )}
                <strong>{parsing ? "正在读取 Excel" : "选择 Excel 文件"}</strong>
                <span>.xls / .xlsx</span>
                <Button
                  isPending={parsing}
                  size="sm"
                  variant="secondary"
                  onPress={() => fileInputRef.current?.click()}
                >
                  选择文件
                </Button>
              </div>
            ) : (
              <div className="excel-modal-workspace">
                <Surface className="dock-panel excel-preview-dock">
                  <header className="dock-header excel-preview-header">
                    <div className="excel-file-meta">
                      <FileSpreadsheet aria-hidden="true" size={16} />
                      <div>
                        <strong>数据预览</strong>
                        <span title={workbook.fileName}>
                          {workbook.fileName} · {formatFileSize(workbook.fileSize)} ·{" "}
                          {workbook.sheets.length} 个工作表
                        </span>
                      </div>
                    </div>
                    <div className="excel-preview-actions">
                      <span>
                        {analysis ? `${analysis.validCount} 个编号` : "0 个编号"}
                      </span>
                      <Button
                        className="excel-replace-button"
                        isPending={parsing}
                        size="sm"
                        variant="secondary"
                        onPress={() => fileInputRef.current?.click()}
                      >
                        更换文件
                      </Button>
                    </div>
                  </header>
                  {analysis ? (
                    <div className="excel-table-wrap">
                      <Table className="excel-table" variant="secondary">
                        <Table.ScrollContainer>
                          <Table.Content aria-label="Excel 编号预览">
                            <Table.Header>
                              <Table.Column isRowHeader>行</Table.Column>
                              <Table.Column>编号原值</Table.Column>
                              <Table.Column>状态</Table.Column>
                            </Table.Header>
                            <Table.Body>
                              {analysis.preview.map((item) => (
                                <Table.Row key={item.row} id={item.row}>
                                  <Table.Cell>{item.row}</Table.Cell>
                                  <Table.Cell>
                                    <code title={item.value}>{item.value || "—"}</code>
                                  </Table.Cell>
                                  <Table.Cell>
                                    <span
                                      className={
                                        item.empty
                                          ? "excel-empty-status"
                                          : "excel-ready-status"
                                      }
                                    >
                                      {item.empty
                                        ? "空白"
                                        : item.duplicate
                                          ? "重复"
                                          : "就绪"}
                                    </span>
                                  </Table.Cell>
                                </Table.Row>
                              ))}
                            </Table.Body>
                          </Table.Content>
                        </Table.ScrollContainer>
                      </Table>
                      {analysis.preview.length < analysis.totalCount && (
                        <span className="excel-preview-limit">仅预览前 80 行</span>
                      )}
                    </div>
                  ) : (
                    <div className="excel-preview-empty">
                      <FileSpreadsheet size={28} />
                      <span>选择 Excel 后显示数据</span>
                    </div>
                  )}
                </Surface>

                <Surface className="dock-panel excel-flow-dock">
                  <header className="dock-header">
                    <strong>列映射</strong>
                  </header>
                  {sheet && configured && analysis ? (
                    <div className="excel-config-scroll">
                      <CompactSelect
                        className="excel-sheet-select"
                        label="工作表"
                        options={workbook.sheets.map((item, index) => ({
                          id: String(index),
                          label: item.name,
                        }))}
                        value={sheetIndex}
                        onChange={chooseSheet}
                      />
                      <SettingControl
                        label="表头所在行"
                        value={
                          configured.headerRow === sheet.suggestedHeaderRow
                            ? "自动识别"
                            : "已修改"
                        }
                      >
                        <CompactNumberField
                          ariaLabel="表头所在行"
                          maxValue={sheet.rows.length}
                          minValue={1}
                          value={configured.headerRow + 1}
                          onChange={chooseHeaderRow}
                        />
                      </SettingControl>
                      <CompactSelect
                        className="excel-column-select"
                        label="编号列"
                        options={configured.headers}
                        value={configured.columnIndex}
                        onChange={(key) => setColumnIndex(Number(key))}
                      />

                      <div className="excel-stats" aria-label="导入统计">
                        <div>
                          <span>数据行</span>
                          <strong>{analysis.totalCount}</strong>
                        </div>
                        <div>
                          <span>非空</span>
                          <strong>{analysis.validCount}</strong>
                        </div>
                        <div>
                          <span>空白</span>
                          <strong>{analysis.emptyCount}</strong>
                        </div>
                        <div>
                          <span>重复</span>
                          <strong>{analysis.duplicateCount}</strong>
                        </div>
                      </div>

                      {!!analysis.precisionRiskCount && (
                        <div className="excel-warning" role="alert">
                          <AlertTriangle size={15} />
                          <span>
                            {analysis.precisionRiskCount} 个数值可能已被 Excel
                            截断精度
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="excel-config-empty">等待文件</div>
                  )}
                </Surface>
              </div>
            )}
            {fileInput}
          </Modal.Body>
          <Modal.Footer className="excel-modal-footer">
            <Button slot="close" variant="secondary">
              取消
            </Button>
            <Button isDisabled={!analysis?.validCount} onPress={confirmImport}>
              <Check size={15} />
              导入{analysis?.validCount ? ` ${analysis.validCount} 个编号` : ""}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export default function App() {
  const [helpOpen, setHelpOpen] = useState(false);
  const online = useOnlineStatus();

  return (
    <main className="app-shell">
      <header className="app-bar">
        <div className="brand-lockup">
          <BrandMark />
          <strong>欧阳骏条码工作台</strong>
        </div>

        <div className="bar-actions">
          {!online && (
            <span className="offline-indicator" title="离线使用中">
              <WifiOff size={15} />
            </span>
          )}
          <InstallAppButton />
          <Button
            isIconOnly
            aria-label="使用说明"
            className="bar-action"
            size="sm"
            title="使用说明"
            variant="tertiary"
            onPress={() => setHelpOpen(true)}
          >
            <HelpCircle size={16} />
          </Button>
          <ThemeTabs />
        </div>
      </header>

      <section className="app-stage">
        <QuickGenerator />
      </section>

      <HelpDrawer isOpen={helpOpen} onOpenChange={setHelpOpen} />
      <PwaLifecycle />
    </main>
  );
}
