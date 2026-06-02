import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

/// A camera / microphone the user can pick as their default, derived from
/// `navigator.mediaDevices.enumerateDevices()`. Device *labels* are only
/// populated after a camera/mic permission grant, so before that we render a
/// "grant access" prompt (mirroring the web's Devices tab behaviour).
@immutable
class MediaDevice {
  const MediaDevice({required this.deviceId, required this.label});

  final String deviceId;
  final String label;

  /// True when the OS hasn't revealed a human label yet (pre-permission).
  bool get hasLabel => label.trim().isNotEmpty;
}

/// The snapshot powering the Devices tab: the available cameras + mics, whether
/// camera/mic permission has been granted (so labels are visible), and whether
/// the platform supports enumeration at all.
@immutable
class DevicesState {
  const DevicesState({
    this.cameras = const [],
    this.microphones = const [],
    this.permissionGranted = false,
    this.supported = true,
  });

  final List<MediaDevice> cameras;
  final List<MediaDevice> microphones;
  final bool permissionGranted;
  final bool supported;

  /// Labels are hidden when we have devices but the OS withheld their names
  /// (permission not yet granted) — the cue to show the "grant access" CTA.
  bool get labelsHidden =>
      supported &&
      !permissionGranted &&
      (cameras.isNotEmpty || microphones.isNotEmpty) &&
      cameras.every((c) => !c.hasLabel) &&
      microphones.every((m) => !m.hasLabel);
}

/// Enumerates media devices and exposes a [requestPermission] action to reveal
/// their labels. Web has no OS prompt (the browser handles it), so this is a
/// mobile-first flow: request camera+mic, then re-enumerate.
class DevicesController extends AsyncNotifier<DevicesState> {
  @override
  Future<DevicesState> build() => _enumerate();

  Future<DevicesState> _enumerate() async {
    try {
      final granted = await _isGranted();
      final devices = await navigator.mediaDevices.enumerateDevices();

      final cameras = <MediaDevice>[];
      final mics = <MediaDevice>[];
      for (final d in devices) {
        final entry = MediaDevice(deviceId: d.deviceId, label: d.label);
        switch (d.kind) {
          case 'videoinput':
            cameras.add(entry);
          case 'audioinput':
            mics.add(entry);
        }
      }

      return DevicesState(
        cameras: cameras,
        microphones: mics,
        permissionGranted: granted,
        supported: true,
      );
    } catch (e) {
      // Some platforms (e.g. an emulator without the WebRTC plugin) can't
      // enumerate — degrade gracefully rather than throwing into the UI.
      if (kDebugMode) debugPrint('[settings] enumerateDevices failed: $e');
      return const DevicesState(supported: false);
    }
  }

  Future<bool> _isGranted() async {
    final cam = await Permission.camera.status;
    final mic = await Permission.microphone.status;
    return (cam.isGranted || cam.isLimited) && (mic.isGranted || mic.isLimited);
  }

  /// Request camera + mic permission, then re-enumerate so labels appear.
  Future<void> requestPermission() async {
    await [Permission.camera, Permission.microphone].request();
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_enumerate);
  }

  /// Deep-link to the OS app settings (permanently-denied recovery).
  Future<void> openSettings() => openAppSettings();

  /// Re-scan devices (e.g. after plugging in a headset).
  Future<void> refresh() async {
    state = await AsyncValue.guard(_enumerate);
  }
}

/// The media-devices controller for the settings Devices section.
final devicesControllerProvider =
    AsyncNotifierProvider<DevicesController, DevicesState>(
        DevicesController.new);
