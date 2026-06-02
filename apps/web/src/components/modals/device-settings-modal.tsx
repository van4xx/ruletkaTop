'use client';

/**
 * Camera & microphone picker.
 *
 * Enumerates devices via `navigator.mediaDevices.enumerateDevices()` (after a
 * one-time permission grant so labels are populated), shows a live camera
 * preview + a mic level meter for the selected devices, and persists the chosen
 * `deviceId`s to localStorage under `ruletka.devices` so the roulette / call
 * surfaces can pass them as `getUserMedia` constraints.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Mic, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Spinner,
} from '@ruletka/ui';
import { useModal, useModalProps } from '@/lib/stores/modal-store';

const STORAGE_KEY = 'ruletka.devices';

interface StoredDevices {
  cameraId?: string;
  micId?: string;
}

function readStored(): StoredDevices {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as StoredDevices;
  } catch {
    return {};
  }
}

export function DeviceSettingsModal() {
  const { close } = useModal();
  const { kinds = ['camera', 'microphone'] } = useModalProps<'device-settings'>();
  const wantCamera = kinds.includes('camera');
  const wantMic = kinds.includes('microphone');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>(() => readStored().cameraId ?? '');
  const [micId, setMicId] = useState<string>(() => readStored().micId ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'denied' | 'unsupported'>(
    'loading',
  );
  const [level, setLevel] = useState(0);

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /** (Re)acquire a preview stream for the chosen devices + refresh the lists. */
  const acquire = useCallback(
    async (nextCameraId?: string, nextMicId?: string) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported');
        return;
      }
      stopStream();
      setStatus('loading');
      try {
        const constraints: MediaStreamConstraints = {
          video: wantCamera
            ? nextCameraId
              ? { deviceId: { exact: nextCameraId } }
              : true
            : false,
          audio: wantMic ? (nextMicId ? { deviceId: { exact: nextMicId } } : true) : false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (wantCamera && videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Mic level meter.
        if (wantMic) {
          const AudioCtx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            audioCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              analyser.getByteFrequencyData(data);
              const avg = data.reduce((a, b) => a + b, 0) / data.length;
              setLevel(Math.min(100, Math.round((avg / 160) * 100)));
              rafRef.current = requestAnimationFrame(tick);
            };
            tick();
          }
        }

        // Now labels are available — enumerate.
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === 'videoinput');
        const microphones = devices.filter((d) => d.kind === 'audioinput');
        setCameras(cams);
        setMics(microphones);

        // Resolve the active device ids from the live tracks.
        const activeCam = stream.getVideoTracks()[0]?.getSettings().deviceId;
        const activeMic = stream.getAudioTracks()[0]?.getSettings().deviceId;
        if (wantCamera) setCameraId(nextCameraId ?? activeCam ?? cams[0]?.deviceId ?? '');
        if (wantMic) setMicId(nextMicId ?? activeMic ?? microphones[0]?.deviceId ?? '');

        setStatus('ready');
      } catch {
        setStatus('denied');
      }
    },
    [stopStream, wantCamera, wantMic],
  );

  // Acquire on mount; tear down on unmount.
  useEffect(() => {
    void acquire(cameraId || undefined, micId || undefined);
    return stopStream;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPickCamera(id: string) {
    setCameraId(id);
    void acquire(id, micId || undefined);
  }
  function onPickMic(id: string) {
    setMicId(id);
    void acquire(cameraId || undefined, id);
  }

  function saveAndClose() {
    try {
      const payload: StoredDevices = {};
      if (wantCamera && cameraId) payload.cameraId = cameraId;
      if (wantMic && micId) payload.micId = micId;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* best-effort */
    }
    stopStream();
    close();
  }

  function cancel() {
    stopStream();
    close();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Камера и микрофон</DialogTitle>
        <DialogDescription>
          Выберите устройства для звонков. Проверьте картинку и уровень микрофона.
        </DialogDescription>
      </DialogHeader>

      {status === 'unsupported' ? (
        <Notice text="Ваш браузер не поддерживает выбор устройств." />
      ) : status === 'denied' ? (
        <div className="space-y-3">
          <Notice text="Нет доступа к камере или микрофону. Разрешите доступ в настройках браузера и попробуйте снова." />
          <Button
            type="button"
            variant="outline"
            block
            leadingIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => acquire(cameraId || undefined, micId || undefined)}
          >
            Повторить
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Camera preview */}
          {wantCamera && (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border/60 bg-background-base">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- self-view preview, no audio track rendered */}
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full -scale-x-100 object-cover"
              />
              {status === 'loading' && (
                <div className="absolute inset-0 grid place-items-center bg-background-base/60">
                  <Spinner />
                </div>
              )}
            </div>
          )}

          {/* Camera select */}
          {wantCamera && (
            <div className="space-y-1.5">
              <Label htmlFor="device-camera">
                <Camera className="mr-1 inline h-4 w-4" /> Камера
              </Label>
              <DeviceSelect
                id="device-camera"
                value={cameraId}
                devices={cameras}
                fallbackLabel="Камера"
                onChange={onPickCamera}
              />
            </div>
          )}

          {/* Mic select + meter */}
          {wantMic && (
            <div className="space-y-1.5">
              <Label htmlFor="device-mic">
                <Mic className="mr-1 inline h-4 w-4" /> Микрофон
              </Label>
              <DeviceSelect
                id="device-mic"
                value={micId}
                devices={mics}
                fallbackLabel="Микрофон"
                onChange={onPickMic}
              />
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-label="Уровень микрофона"
                aria-valuenow={level}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-aurora transition-[width] duration-100"
                  style={{ width: `${level}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={cancel}>
          Отмена
        </Button>
        <Button type="button" variant="primary" disabled={status !== 'ready'} onClick={saveAndClose}>
          Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}

function DeviceSelect({
  id,
  value,
  devices,
  fallbackLabel,
  onChange,
}: {
  id: string;
  value: string;
  devices: MediaDeviceInfo[];
  fallbackLabel: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none rounded-xl border border-border bg-input/40 px-3.5 pr-9 text-sm text-foreground transition-colors focus:border-accent-muted focus:outline-none focus:ring-2 focus:ring-input-focus"
      >
        {devices.length === 0 && <option value="">Устройства не найдены</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${fallbackLabel} ${i + 1}`}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-sm">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-foreground">{text}</p>
    </div>
  );
}
