'use client';

/**
 * Enumerate the user's media input devices (cameras + microphones) via the
 * browser `navigator.mediaDevices` API for the Devices settings tab.
 *
 * Device *labels* are only exposed after the user has granted camera/mic
 * permission at least once, so we expose a `requestPermission()` action that
 * prompts (and immediately stops the tracks) to reveal labels, then re-reads
 * the list. We also subscribe to `devicechange` so hot-plugging updates live.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export type DevicePermission = 'unknown' | 'granted' | 'denied' | 'prompt';

export interface UseDevicesResult {
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  permission: DevicePermission;
  /** True if the browser exposes `mediaDevices.enumerateDevices`. */
  supported: boolean;
  loading: boolean;
  error: string | null;
  /** Prompt for camera+mic so device labels become available. */
  requestPermission: () => Promise<void>;
  /** Re-read the device list. */
  refresh: () => Promise<void>;
}

function labelFor(device: MediaDeviceInfo, index: number, kind: string): string {
  if (device.label) return device.label;
  return `${kind} ${index + 1}`;
}

export function useDevices(): UseDevicesResult {
  const t = useTranslations('settings');
  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.enumerateDevices === 'function';

  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([]);
  const [permission, setPermission] = useState<DevicePermission>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    setError(null);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams: MediaDeviceOption[] = [];
      const mics: MediaDeviceOption[] = [];
      let camIdx = 0;
      let micIdx = 0;
      for (const d of devices) {
        if (d.kind === 'videoinput') {
          cams.push({ deviceId: d.deviceId, label: labelFor(d, camIdx++, t('devices.cameraFallback')) });
        } else if (d.kind === 'audioinput') {
          mics.push({ deviceId: d.deviceId, label: labelFor(d, micIdx++, t('devices.micFallback')) });
        }
      }
      setCameras(cams);
      setMicrophones(mics);
      // If any label is present, permission has been granted at some point.
      if (devices.some((d) => d.label)) setPermission('granted');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('devices.errors.enumerate'));
    } finally {
      setLoading(false);
    }
  }, [supported, t]);

  const requestPermission = useCallback(async () => {
    if (!supported || typeof navigator.mediaDevices.getUserMedia !== 'function') return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      // We only needed the grant to reveal labels — release the hardware now.
      stream.getTracks().forEach((track) => track.stop());
      setPermission('granted');
      await refresh();
    } catch (e) {
      setPermission('denied');
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? t('devices.errors.permissionDenied')
          : t('devices.errors.accessFailed'),
      );
    }
  }, [supported, refresh, t]);

  // Initial read + permission probe + live updates on hot-plug.
  useEffect(() => {
    if (!supported) return;

    let cancelled = false;

    // Best-effort permission probe (not supported in every browser).
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (!cancelled) setPermission(status.state as DevicePermission);
      })
      .catch(() => {
        /* permissions API unavailable — leave as unknown */
      });

    void refresh();

    const onChange = () => void refresh();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
    };
  }, [supported, refresh]);

  return {
    cameras,
    microphones,
    permission,
    supported,
    loading,
    error,
    requestPermission,
    refresh,
  };
}
