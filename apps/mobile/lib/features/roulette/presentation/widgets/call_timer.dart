import 'dart:async';

import 'package:flutter/material.dart';

/// A live `MM:SS` (or `H:MM:SS`) call timer. Starts ticking when [running]
/// becomes true and resets to zero when it goes false — mirrors the web
/// `useCallTimer`. Rebuilds only itself (a single `Text`), once per second.
class CallTimer extends StatefulWidget {
  const CallTimer({super.key, required this.running, this.style});

  final bool running;
  final TextStyle? style;

  @override
  State<CallTimer> createState() => _CallTimerState();
}

class _CallTimerState extends State<CallTimer> {
  Timer? _timer;
  int _seconds = 0;

  @override
  void didUpdateWidget(covariant CallTimer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.running != oldWidget.running) {
      if (widget.running) {
        _start();
      } else {
        _stop();
      }
    }
  }

  @override
  void initState() {
    super.initState();
    if (widget.running) _start();
  }

  void _start() {
    _seconds = 0;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _seconds++);
    });
  }

  void _stop() {
    _timer?.cancel();
    _timer = null;
    if (mounted) setState(() => _seconds = 0);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String get _formatted {
    final h = _seconds ~/ 3600;
    final m = (_seconds % 3600) ~/ 60;
    final s = _seconds % 60;
    final mm = m.toString().padLeft(2, '0');
    final ss = s.toString().padLeft(2, '0');
    return h > 0 ? '$h:$mm:$ss' : '$mm:$ss';
  }

  @override
  Widget build(BuildContext context) {
    return Text(
      _formatted,
      style: widget.style,
    );
  }
}
