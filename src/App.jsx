import {
  Button,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
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
  ChevronDown,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  HelpCircle,
  LoaderCircle,
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
const DOWNLOAD_FORMATS = ["png", "svg"];
const DOWNLOAD_RECORD_TTL = 60_000;
const DOWNLOAD_RECORD_COLLAPSE_DURATION = 320;
const DOWNLOAD_RECORD_REMOVE_GRACE = DOWNLOAD_RECORD_COLLAPSE_DURATION + 80;
const PREVIEW_SETTLE_DELAY = 160;
const PREVIEW_TRANSITION_DURATION = 360;
const PWA_UPDATE_INTERVAL = 15 * 60_000;
const INPUT_DRAFT_KEY = "barcode-input-draft-v1";
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

function readInputDraft() {
  try {
    return sessionStorage.getItem(INPUT_DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

function removeInputRecords(input, downloadedRecords, removeMatchingValues = false) {
  const downloadedIds = new Set(downloadedRecords.map((record) => record.id));
  const downloadedValues = new Set(
    downloadedRecords.map((record) => record.value),
  );
  let recordIndex = 0;

  return input
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .filter((line) => {
      const value = line.trim();
      if (!value) return true;
      const recordId = `${recordIndex}-${value}`;
      recordIndex += 1;
      return removeMatchingValues
        ? !downloadedValues.has(value)
        : !downloadedIds.has(recordId);
    })
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
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
        item.expiresAt + DOWNLOAD_RECORD_REMOVE_GRACE > now,
    );
  } catch {
    return [];
  }
}

function downloadRecordStyle(item) {
  const lifecycleDuration =
    DOWNLOAD_RECORD_TTL + DOWNLOAD_RECORD_COLLAPSE_DURATION;
  const age = Math.min(
    lifecycleDuration,
    Math.max(0, Date.now() - item.downloadedAtMs),
  );
  const collapseAge = Math.max(0, age - DOWNLOAD_RECORD_TTL);
  const collapseDelay =
    age < DOWNLOAD_RECORD_TTL
      ? `${DOWNLOAD_RECORD_TTL - age}ms`
      : `-${collapseAge}ms`;
  return {
    "--download-record-collapse-delay": collapseDelay,
    "--download-record-collapse-duration": `${DOWNLOAD_RECORD_COLLAPSE_DURATION}ms`,
    "--download-record-fade-delay": `-${Math.min(age, DOWNLOAD_RECORD_TTL)}ms`,
    "--download-record-fade-duration": `${DOWNLOAD_RECORD_TTL}ms`,
  };
}

function downloadRecordIndex(item) {
  if (Number.isInteger(item.recordIndex) && item.recordIndex >= 0) {
    return item.recordIndex;
  }
  const separatorIndex = item.recordId.indexOf("-");
  const recordIndex = Number(item.recordId.slice(0, separatorIndex));
  return Number.isInteger(recordIndex) && recordIndex >= 0 ? recordIndex : null;
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function storedColor(value, fallback, allowAlpha = false) {
  if (typeof value !== "string") return fallback;
  try {
    const color = parseColor(value);
    if (allowAlpha) return color.toString("css");
    return color.withChannelValue("alpha", 1).toString("hex");
  } catch {
    return fallback;
  }
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
  const lineColor = storedColor(
    barcode.lineColor,
    DEFAULT_SETTINGS.lineColor,
  );

  return {
    clearAfterDownload: stored.clearAfterDownload === true,
    downloadFormat: DOWNLOAD_FORMATS.includes(stored.downloadFormat)
      ? stored.downloadFormat
      : "png",
    enterAction: ENTER_ACTIONS.includes(stored.enterAction)
      ? stored.enterAction
      : "newline",
    excludeDuplicates: stored.excludeDuplicates === true,
    settings: {
      ...DEFAULT_SETTINGS,
      background: storedColor(
        barcode.background,
        DEFAULT_SETTINGS.background,
        true,
      ),
      displayValue,
      exportHeightCm,
      exportWidthCm,
      fontSize,
      lineColor,
      textColor: storedColor(barcode.textColor, lineColor),
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
    <SegmentedControl
      aria-label="界面主题"
      className="theme-tabs"
      selectedKeys={new Set([theme])}
      onSelectionChange={(keys) => {
        const nextTheme = [...keys][0];
        if (nextTheme) setTheme(String(nextTheme));
      }}
    >
      <ToggleButton id="system">自动</ToggleButton>
      <ToggleButton id="light">亮色</ToggleButton>
      <ToggleButton id="dark">暗色</ToggleButton>
    </SegmentedControl>
  );
}

function SegmentedControl({ className = "", ...props }) {
  return (
    <ToggleButtonGroup
      {...props}
      className={["segmented-control", className].filter(Boolean).join(" ")}
      disallowEmptySelection
      selectionMode="single"
      size="sm"
    />
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
    needRefresh: [needRefresh],
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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    let registration;
    let reloadStarted = false;

    const reloadWhenControllerChanges = () => {
      if (reloadStarted) return;
      reloadStarted = true;
      try {
        const input = document.querySelector('[aria-label="编号内容"]');
        if (input instanceof HTMLTextAreaElement) {
          sessionStorage.setItem(INPUT_DRAFT_KEY, input.value);
        }
      } catch {
        // Reload still proceeds when session storage is unavailable.
      }
      window.location.reload();
    };

    const checkForUpdate = async () => {
      if (!navigator.onLine) return;
      try {
        registration ||= await navigator.serviceWorker.ready;
        await registration.update();
      } catch (error) {
        console.error("PWA update check failed", error);
      }
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    checkForUpdate();
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      reloadWhenControllerChanges,
    );
    addEventListener("online", checkForUpdate);
    document.addEventListener("visibilitychange", checkWhenVisible);
    const intervalId = window.setInterval(checkForUpdate, PWA_UPDATE_INTERVAL);
    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        reloadWhenControllerChanges,
      );
      removeEventListener("online", checkForUpdate);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!needRefresh) return;
    updateServiceWorker(true).catch((error) => {
      console.error("PWA update failed", error);
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
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
                <li>单条与多条都按“属性”中的文件格式逐个下载。</li>
                <li>浏览器首次批量下载时，可能需要允许多个文件。</li>
                <li>“合并重复编号”开启后，同值输入会作为一个编号组处理。</li>
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
                  <dt>下载后移除输入</dt>
                  <dd>下载完成后移除对应编号并重新聚焦输入框</dd>
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

function BarcodePreview({ aspectRatio, record, stackCount = 0 }) {
  const layers = usePreviewLayers(record);
  const normalizedAspectRatio = boundedNumber(aspectRatio, 0.3, 20, 2);
  const { containerRef, size } = usePreviewViewport(normalizedAspectRatio);
  const backLayerCount = record
    ? Math.max(0, Math.min(4, stackCount) - 1)
    : 0;

  return (
    <div className="preview-frame" ref={containerRef}>
      <div
        className="preview-stack"
        data-count={backLayerCount + (record ? 1 : 0)}
        data-ready={size ? "true" : "false"}
        style={size ? { height: size.height, width: size.width } : undefined}
      >
        {Array.from({ length: backLayerCount }, (_, index) => {
          const depth = backLayerCount - index;
          return (
            <span
              aria-hidden="true"
              className="preview-stack-card"
              key={`stack-${depth}`}
              style={{ "--stack-depth": depth }}
            />
          );
        })}
        <div className="preview-viewport">
          {layers.previous && (
            <PreviewBarcodeLayer
              className="is-base"
              key={`previous-${layers.previous.svg}`}
              record={layers.previous}
            />
          )}
          {layers.current ? (
            <PreviewBarcodeLayer
              className={layers.previous ? "is-revealing" : "is-current"}
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

function ColorSetting({
  allowAlpha = false,
  ariaLabel,
  isDisabled = false,
  value,
  onChange,
}) {
  const color = parseColor(value);
  const alpha = Math.round(color.getChannelValue("alpha") * 100);
  return (
    <ColorPicker
      className="compact-color-picker"
      value={color}
      onChange={(nextColor) =>
        onChange(nextColor.toString(allowAlpha ? "css" : "hex"))
      }
    >
      <ColorPicker.Trigger
        aria-label={`选择${ariaLabel}`}
        className="compact-color-trigger"
        isDisabled={isDisabled}
        title={`选择${ariaLabel}`}
      >
        <ColorSwatch
          aria-label={`${ariaLabel}预览`}
          color={color}
          shape="square"
          size="sm"
        />
        <span className="compact-color-value">
          {color.toString("hex")}
        </span>
        {allowAlpha && (
          <span className="compact-color-alpha">{alpha}%</span>
        )}
      </ColorPicker.Trigger>
      <ColorPicker.Popover
        className="compact-color-popover"
        placement="left top"
      >
        <ColorArea
          aria-label={`${ariaLabel}色彩区域`}
          className="compact-color-area"
          colorSpace="hsb"
          xChannel="saturation"
          yChannel="brightness"
        >
          <ColorArea.Thumb />
        </ColorArea>
        <ColorSlider
          aria-label={`${ariaLabel}色相`}
          channel="hue"
          className="compact-color-slider"
          colorSpace="hsb"
        >
          <Label>色相</Label>
          <ColorSlider.Output />
          <ColorSlider.Track>
            <ColorSlider.Thumb />
          </ColorSlider.Track>
        </ColorSlider>
        {allowAlpha && (
          <ColorSlider
            aria-label={`${ariaLabel}透明度`}
            channel="alpha"
            className="compact-color-slider"
            colorSpace="hsb"
          >
            <Label>透明度</Label>
            <ColorSlider.Output />
            <ColorSlider.Track>
              <ColorSlider.Thumb />
            </ColorSlider.Track>
          </ColorSlider>
        )}
        <ColorField fullWidth aria-label={`${ariaLabel}颜色值`}>
          <ColorField.Group fullWidth variant="secondary">
            <ColorField.Prefix>
              <ColorSwatch shape="square" size="xs" />
            </ColorField.Prefix>
            <ColorField.Input />
          </ColorField.Group>
        </ColorField>
      </ColorPicker.Popover>
    </ColorPicker>
  );
}

function InspectorControls({
  clearAfterDownload,
  downloadFormat,
  excludeDuplicates,
  onClearAfterDownloadChange,
  onDownloadFormatChange,
  onExcludeDuplicatesChange,
  onSettingsChange,
  settings,
}) {
  return (
    <div className="inspector-controls">
      <section className="inspector-section inspector-section--appearance">
        <div className="inspector-group">
          <div className="inspector-group-label">条码</div>
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
                allowAlpha
                ariaLabel="背景颜色"
                value={settings.background}
                onChange={(background) => onSettingsChange({ background })}
              />
            </SettingControl>
          </div>
        </div>

        <div className="inspector-group">
          <div className="inspector-group-label">编号文字</div>
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
          <div className="setting-grid">
            <SettingControl
              label="最大字号"
              value={settings.displayValue ? undefined : "已隐藏"}
            >
              <CompactNumberField
                ariaLabel="编号文字最大字号"
                isDisabled={!settings.displayValue}
                maxValue={36}
                minValue={10}
                value={settings.fontSize}
                onChange={(fontSize) => onSettingsChange({ fontSize })}
              />
            </SettingControl>
            <SettingControl label="文字颜色">
              <ColorSetting
                ariaLabel="编号文字颜色"
                isDisabled={!settings.displayValue}
                value={settings.textColor}
                onChange={(textColor) => onSettingsChange({ textColor })}
              />
            </SettingControl>
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <SettingControl label="文件格式">
          <SegmentedControl
            fullWidth
            aria-label="下载文件格式"
            selectedKeys={new Set([downloadFormat])}
            onSelectionChange={(keys) => {
              const next = String([...keys][0] || "");
              if (DOWNLOAD_FORMATS.includes(next)) onDownloadFormatChange(next);
            }}
          >
            <ToggleButton id="png">PNG</ToggleButton>
            <ToggleButton id="svg">SVG</ToggleButton>
          </SegmentedControl>
        </SettingControl>
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
              下载后移除输入
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
              合并重复编号
            </Switch.Content>
          </Switch>
        </div>
      </section>
    </div>
  );
}

function DownloadActionButton({
  count,
  enterAction,
  exporting,
  onPress,
}) {
  const isBatch = count > 1;
  const shortcut = enterAction === "download" ? "Enter" : "⌘ / Ctrl + Enter";

  return (
    <Button
      fullWidth
      aria-label={`${isBatch ? `批量下载 ${count} 个条码` : "下载条码"}，快捷键 ${shortcut}`}
      className="inspector-download-button"
      isDisabled={!count}
      isPending={exporting}
      size="sm"
      onPress={onPress}
    >
      <Download aria-hidden="true" size={15} />
      <span>{isBatch ? `批量下载 (${count})` : "下载"}</span>
      <kbd>{shortcut}</kbd>
    </Button>
  );
}

function QuickGenerator() {
  const [initialPreferences] = useState(readGeneratorPreferences);
  const [input, setInput] = useState(readInputDraft);
  const [settings, setSettings] = useState(initialPreferences.settings);
  const [clearAfterDownload, setClearAfterDownload] = useState(
    initialPreferences.clearAfterDownload,
  );
  const [downloadFormat, setDownloadFormat] = useState(
    initialPreferences.downloadFormat,
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
      downloadFormat,
      enterAction,
      excludeDuplicates,
    });
  }, [clearAfterDownload, downloadFormat, enterAction, excludeDuplicates, settings]);

  useEffect(() => {
    try {
      sessionStorage.setItem(INPUT_DRAFT_KEY, input);
    } catch {
      // The current input remains available in memory when storage is unavailable.
    }
  }, [input]);

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
    const nextRemoval = Math.min(
      ...recentDownloads.map(
        (item) => item.expiresAt + DOWNLOAD_RECORD_REMOVE_GRACE,
      ),
    );
    const timeoutId = window.setTimeout(() => {
      const now = Date.now();
      setRecentDownloads((current) =>
        current.filter(
          (item) => item.expiresAt + DOWNLOAD_RECORD_REMOVE_GRACE > now,
        ),
      );
    }, Math.max(0, nextRemoval - Date.now()));
    return () => window.clearTimeout(timeoutId);
  }, [recentDownloads]);

  const records = useMemo(() => parseBarcodeInput(input, settings), [input, settings]);
  const valueCounts = useMemo(() => {
    const counts = new Map();
    for (const record of records) {
      counts.set(record.value, (counts.get(record.value) || 0) + 1);
    }
    return counts;
  }, [records]);
  const displayRecords = useMemo(() => {
    if (!excludeDuplicates) return records;
    const seen = new Set();
    return records.filter((record) => {
      if (seen.has(record.value)) return false;
      seen.add(record.value);
      return true;
    });
  }, [excludeDuplicates, records]);
  const visibleRecords = useMemo(
    () => displayRecords.filter((record) => !hiddenDownloadedIds.has(record.id)),
    [displayRecords, hiddenDownloadedIds],
  );
  const validRecords = useMemo(
    () => displayRecords.filter((record) => record.valid),
    [displayRecords],
  );
  const visibleValidRecords = useMemo(
    () => visibleRecords.filter((record) => record.valid),
    [visibleRecords],
  );
  const recordRows = useMemo(() => {
    const latestDownloadByRecordId = new Map();
    for (const item of recentDownloads) {
      if (!latestDownloadByRecordId.has(item.recordId)) {
        latestDownloadByRecordId.set(item.recordId, item);
      }
    }

    const inlineDownloadIds = new Set();
    const renderedValues = new Set();
    const rows = [...displayRecords].reverse().flatMap((record) => {
      renderedValues.add(record.value);
      if (!hiddenDownloadedIds.has(record.id)) {
        return [{ download: null, key: `record:${record.id}`, record }];
      }

      const download = latestDownloadByRecordId.get(record.id);
      if (!download) return [];
      inlineDownloadIds.add(download.id);
      return [{ download, key: `record:${record.id}`, record }];
    });

    for (const download of recentDownloads) {
      if (excludeDuplicates && renderedValues.has(download.value)) continue;
      if (!inlineDownloadIds.has(download.id)) {
        renderedValues.add(download.value);
        rows.push({
          download,
          key: `download:${download.id}`,
          record: null,
        });
      }
    }
    return rows;
  }, [displayRecords, excludeDuplicates, hiddenDownloadedIds, recentDownloads]);
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

  const finishDownload = (downloadedRecords) => {
    window.setTimeout(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      if (clearAfterDownload) {
        setInput((current) =>
          removeInputRecords(
            current,
            downloadedRecords,
            excludeDuplicates,
          ),
        );
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
        mergedCount: excludeDuplicates
          ? valueCounts.get(record.value) || 1
          : 1,
        recordId: record.id,
        recordIndex: record.index,
        value: record.value,
      }));
    const downloadedValues = new Set(
      downloadedRecords.map((record) => record.value),
    );
    const downloadedRecordIds = excludeDuplicates
      ? records
          .filter((record) => downloadedValues.has(record.value))
          .map((record) => record.id)
      : entries.map((item) => item.recordId);
    setHiddenDownloadedIds((current) =>
      new Set([...current, ...downloadedRecordIds]),
    );
    setRecentDownloads((current) => [
      ...entries,
      ...current.filter(
        (item) =>
          item.expiresAt + DOWNLOAD_RECORD_REMOVE_GRACE > downloadedAtMs,
      ),
    ]);
  };

  const exportOne = async (record = selectedRecord, remember = true) => {
    if (!record || exporting) return;
    setExporting(true);
    try {
      const filename = await downloadRecord(
        record,
        downloadFormat,
        settings.exportHeightCm,
        settings.exportWidthCm,
      );
      if (remember) rememberDownloads([record], downloadFormat);
      toast.success("已下载", { description: filename });
      finishDownload([record]);
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
        downloadFormat,
        settings.exportHeightCm,
        settings.exportWidthCm,
      );
      if (remember) rememberDownloads(downloadableRecords, downloadFormat);
      toast.success("已发起批量下载", {
        description: `${filenames.length} 个 ${downloadFormat.toUpperCase()}`,
      });
      finishDownload(downloadableRecords);
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
      if (downloadableRecords.length > 1) exportAll();
      else exportOne();
    }
  };

  const changeSettings = (next) =>
    setSettings((current) => ({ ...current, ...next }));

  return (
    <>
      <div className="quick-workspace">
      <Surface className="dock-panel input-dock">
        <header className="dock-header input-header">
          <strong>输入</strong>
          <div className="input-header-tools">
            <span className="input-count">
              {records.length ? `${validRecords.length}/${records.length}` : "0"}
            </span>
            <Button
              isIconOnly
              aria-label="粘贴"
              size="sm"
              title="粘贴"
              variant="ghost"
              onPress={pasteFromClipboard}
            >
              <ClipboardPaste size={14} />
            </Button>
            <Button
              isIconOnly
              aria-label="导入 Excel"
              size="sm"
              title="导入 Excel"
              variant="ghost"
              onPress={() => setExcelOpen(true)}
            >
              <FileSpreadsheet size={14} />
            </Button>
            <Button
              isIconOnly
              aria-label="删除全部输入"
              isDisabled={!input}
              size="sm"
              title="删除"
              variant="ghost"
              onPress={() => {
                setInput("");
                setSelectedId(null);
                setHiddenDownloadedIds(new Set());
                inputRef.current?.focus();
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
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
            <SegmentedControl
              aria-label="回车键行为"
              className="enter-action-control"
              selectedKeys={new Set([enterAction])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (ENTER_ACTIONS.includes(String(next))) setEnterAction(String(next));
              }}
            >
              <ToggleButton id="newline">回车换行</ToggleButton>
              <ToggleButton id="download">回车下载</ToggleButton>
            </SegmentedControl>
            <span className="enter-action-hint" aria-live="polite">
              {enterAction === "download"
                ? "换行：Shift + Enter"
                : "下载：⌘ / Ctrl + Enter"}
            </span>
          </div>
        </div>

        <div className="record-list" aria-label="条码记录列表" aria-live="polite">
          {!recordRows.length && (
            <span className="records-empty">
              {records.length ? "已全部处理" : "等待编号"}
            </span>
          )}
          {recordRows.map(({ download, key, record }) => {
            if (download) {
              const recordIndex = record?.index ?? downloadRecordIndex(download);
              const mergedCount = Math.max(
                1,
                download.mergedCount || valueCounts.get(download.value) || 1,
              );
              return (
                <div
                  className="record-row is-downloaded"
                  key={key}
                  style={downloadRecordStyle(download)}
                >
                  <div className="record-content archived-download-content">
                    <span className="record-index">
                      {recordIndex === null ? "—" : recordIndex + 1}
                    </span>
                    <span className="record-text">
                      <span className="record-value-line">
                        <strong title={download.value}>{download.value}</strong>
                        {mergedCount > 1 && (
                          <span
                            className="duplicate-count"
                            title={`已合并 ${mergedCount} 行相同编号`}
                          >
                            ×{mergedCount}
                          </span>
                        )}
                      </span>
                      <small>
                        已下载 · {download.format} · {download.downloadedAt}
                      </small>
                    </span>
                  </div>
                  <span className="record-downloaded-indicator" aria-hidden="true">
                    <Check size={13} />
                  </span>
                </div>
              );
            }

            const mergedCount = valueCounts.get(record.value) || 1;
            return (
              <div
                className={`record-row ${selectedRecord?.id === record.id ? "is-selected" : ""} ${!record.valid ? "is-invalid" : ""}`}
                key={key}
              >
                <Button
                  className="record-content record-select-button"
                  isDisabled={!record.valid}
                  variant="ghost"
                  onPress={() => setSelectedId(record.id)}
                >
                  <span className="record-index">
                    {record.index + 1}
                  </span>
                  <span className="record-text">
                    <span className="record-value-line">
                      <strong title={record.value}>{record.value}</strong>
                      {excludeDuplicates && mergedCount > 1 && (
                        <span
                          className="duplicate-count"
                          title={`已合并 ${mergedCount} 行相同编号`}
                        >
                          ×{mergedCount}
                        </span>
                      )}
                    </span>
                    <small>
                      {record.error ||
                        (record.duplicate && !excludeDuplicates ? "重复" : "就绪")}
                    </small>
                  </span>
                </Button>
                {record.valid && (
                  <Button
                    isIconOnly
                    aria-label={`下载 ${record.value}`}
                    className="record-download-button"
                    size="sm"
                    variant="ghost"
                    isDisabled={exporting}
                    onPress={() => exportOne(record)}
                  >
                    <Download size={14} />
                  </Button>
                )}
              </div>
            );
          })}
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
          </div>
        </header>
        <div className="canvas-stage">
          <div className="preview-paper">
            <BarcodePreview
              aspectRatio={settings.exportWidthCm / settings.exportHeightCm}
              record={selectedRecord}
              stackCount={visibleValidRecords.length}
            />
          </div>
        </div>
      </Surface>

      <Surface className="dock-panel inspector-dock">
        <header className="dock-header">
          <strong>属性</strong>
        </header>
        <div className="inspector-scroll">
          <InspectorControls
            clearAfterDownload={clearAfterDownload}
            downloadFormat={downloadFormat}
            excludeDuplicates={excludeDuplicates}
            settings={settings}
            onClearAfterDownloadChange={setClearAfterDownload}
            onDownloadFormatChange={setDownloadFormat}
            onExcludeDuplicatesChange={setExcludeDuplicates}
            onSettingsChange={changeSettings}
          />
        </div>
        <footer className="inspector-download-footer">
          <DownloadActionButton
            count={downloadableRecords.length}
            enterAction={enterAction}
            exporting={exporting}
            onPress={() =>
              downloadableRecords.length > 1 ? exportAll() : exportOne()
            }
          />
        </footer>
      </Surface>

      <footer className="mobile-bottom-toolbar">
        <Button
          aria-controls="mobile-settings-sheet"
          aria-expanded={settingsOpen}
          className="mobile-bottom-settings-button"
          size="sm"
          variant="secondary"
          onPress={() => setSettingsOpen(true)}
        >
          <Settings2 aria-hidden="true" size={15} />
          <span>属性</span>
        </Button>
        <div className="mobile-bottom-download">
          <DownloadActionButton
            count={downloadableRecords.length}
            enterAction={enterAction}
            exporting={exporting}
            onPress={() =>
              downloadableRecords.length > 1 ? exportAll() : exportOne()
            }
          />
        </div>
      </footer>

      <Drawer.Backdrop isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog
            className="mobile-settings-sheet"
            id="mobile-settings-sheet"
          >
            <Drawer.Handle />
            <Drawer.Header className="mobile-settings-sheet-header">
              <Drawer.Heading>属性</Drawer.Heading>
              <Button
                isIconOnly
                aria-label="收起属性"
                size="sm"
                slot="close"
                variant="ghost"
              >
                <ChevronDown aria-hidden="true" size={16} />
              </Button>
            </Drawer.Header>
            <Drawer.Body className="mobile-settings-sheet-body">
              <InspectorControls
                clearAfterDownload={clearAfterDownload}
                downloadFormat={downloadFormat}
                excludeDuplicates={excludeDuplicates}
                settings={settings}
                onClearAfterDownloadChange={setClearAfterDownload}
                onDownloadFormatChange={setDownloadFormat}
                onExcludeDuplicatesChange={setExcludeDuplicates}
                onSettingsChange={changeSettings}
              />
            </Drawer.Body>
            <Drawer.Footer className="inspector-download-footer">
              <DownloadActionButton
                count={downloadableRecords.length}
                enterAction={enterAction}
                exporting={exporting}
                onPress={() =>
                  downloadableRecords.length > 1 ? exportAll() : exportOne()
                }
              />
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
      <Modal.Container
        className="excel-modal-container"
        placement="center"
        scroll="inside"
        size="cover"
      >
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
                <section className="excel-preview-pane">
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
                  <footer className="excel-preview-footer">
                    <Button
                      isDisabled={!analysis?.validCount}
                      size="sm"
                      variant="primary"
                      onPress={confirmImport}
                    >
                      <Check size={14} />
                      导入{analysis?.validCount ? ` ${analysis.validCount} 个编号` : ""}
                    </Button>
                  </footer>
                </section>

                <aside className="excel-flow-pane excel-flow-dock">
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
                </aside>
              </div>
            )}
            {fileInput}
          </Modal.Body>
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
