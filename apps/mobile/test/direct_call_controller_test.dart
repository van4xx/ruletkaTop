// Unit tests for the global direct-call (friend call) signaling layer + the
// chat thread route-arg parsing fix.
//
//  * [ThreadArg.parse] must decode the `c:`/`u:`/`new`/bare route params so a
//    prefixed deep-link loads (or composes) the right thread.
//  * [DirectCallController] drives the incoming/outgoing ring lifecycle off the
//    `call:*` socket events. We drive it through a fake [SocketService] that
//    captures emits and lets the test inject inbound events.

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ruletka/core/api/api.dart';
import 'package:ruletka/core/di/di.dart';
import 'package:ruletka/core/models/models.dart';
import 'package:ruletka/core/socket/socket.dart';
import 'package:ruletka/features/calls/application/pending_direct_call.dart';
import 'package:ruletka/features/calls/domain/direct_call_controller.dart';
import 'package:ruletka/features/chat/domain/chat_thread_controller.dart';

/// A [SocketService] test double: records outbound `call:*` emits and exposes
/// the registered inbound handlers so a test can fire server→client events.
class _FakeSocket extends SocketService {
  _FakeSocket() : super(TokenStore(TokenStore.createStorage()));

  final List<String> emitted = [];
  void Function(IncomingCall)? incoming;
  void Function(CallResponsePayload)? accepted;
  void Function(CallResponsePayload)? declined;
  void Function(CallResponsePayload)? ended;

  @override
  void callInvite(String toUserId, MatchType type) => emitted.add('invite:$toUserId');
  @override
  void callAccept(String callId) => emitted.add('accept:$callId');
  @override
  void callDecline(String callId) => emitted.add('decline:$callId');
  @override
  void callEnd(String callId) => emitted.add('end:$callId');

  @override
  VoidCallback onIncomingCall(void Function(IncomingCall) cb) {
    incoming = cb;
    return () => incoming = null;
  }

  @override
  VoidCallback onCallAccept(void Function(CallResponsePayload) cb) {
    accepted = cb;
    return () => accepted = null;
  }

  @override
  VoidCallback onCallDecline(void Function(CallResponsePayload) cb) {
    declined = cb;
    return () => declined = null;
  }

  @override
  VoidCallback onCallEnd(void Function(CallResponsePayload) cb) {
    ended = cb;
    return () => ended = null;
  }
}

ProviderContainer _container(_FakeSocket socket) {
  final c = ProviderContainer(overrides: [
    socketServiceProvider.overrideWithValue(socket),
  ]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('ThreadArg.parse (chat route id)', () {
    test('a c:-prefixed id loads an existing conversation', () {
      final arg = ThreadArg.parse('c:abc123');
      expect(arg.isCompose, isFalse);
      expect(arg.conversationId, 'abc123');
    });

    test('a u:-prefixed id composes with that recipient', () {
      final arg = ThreadArg.parse('u:user42');
      expect(arg.isCompose, isTrue);
      expect(arg.recipientId, 'user42');
    });

    test('"new" composes an empty thread', () {
      final arg = ThreadArg.parse('new');
      expect(arg.isCompose, isTrue);
      expect(arg.recipientId, '');
    });

    test('a bare id is treated as a conversation', () {
      final arg = ThreadArg.parse('plain');
      expect(arg.isCompose, isFalse);
      expect(arg.conversationId, 'plain');
    });
  });

  group('DirectCallController — incoming (callee)', () {
    test('an incoming invite rings, and accept launches the callee stage '
        'WITHOUT emitting call:accept (the engine emits it after building the PC)', () {
      final socket = _FakeSocket();
      final c = _container(socket);
      // Force the controller to build (wiring the listeners).
      c.read(directCallControllerProvider);

      socket.incoming!(const IncomingCall(
        callId: 'call-1',
        fromUserId: 'friend-1',
        toUserId: 'me',
        type: MatchType.video,
      ));

      var state = c.read(directCallControllerProvider);
      expect(state.hasRing, isTrue);
      expect(state.ring!.isIncoming, isTrue);
      expect(state.ring!.peerUserId, 'friend-1');

      c.read(directCallControllerProvider.notifier).accept();
      state = c.read(directCallControllerProvider);
      // The accept handshake is DEFERRED to the roulette engine (it emits
      // call:accept only after the answerer PC exists), so none is emitted here.
      expect(socket.emitted, isNot(contains('accept:call-1')));
      expect(state.hasRing, isFalse);
      expect(state.launch, isNotNull);
      expect(state.launch!.type, MatchType.video);
      expect(state.launch!.role, DirectCallLaunchRole.callee);
      expect(state.launch!.callId, 'call-1');
    });

    test('decline emits call:decline and clears the ring', () {
      final socket = _FakeSocket();
      final c = _container(socket);
      c.read(directCallControllerProvider);

      socket.incoming!(const IncomingCall(
        callId: 'call-2',
        fromUserId: 'friend-2',
        toUserId: 'me',
        type: MatchType.voice,
      ));
      c.read(directCallControllerProvider.notifier).decline();

      expect(socket.emitted, contains('decline:call-2'));
      expect(c.read(directCallControllerProvider).hasRing, isFalse);
    });
  });

  group('DirectCallController — outgoing (caller)', () {
    test('placeCall rings, and the callee accept launches the stage', () {
      final socket = _FakeSocket();
      final c = _container(socket);
      c.read(directCallControllerProvider);

      c.read(directCallControllerProvider.notifier)
          .placeCall('friend-3', MatchType.video);
      expect(socket.emitted, contains('invite:friend-3'));
      expect(c.read(directCallControllerProvider).ring!.isOutgoing, isTrue);

      // Server relays the callee's acceptance with the minted call id.
      socket.accepted!(const CallResponsePayload(callId: 'call-3'));
      final state = c.read(directCallControllerProvider);
      expect(state.hasRing, isFalse);
      expect(state.launch, isNotNull);
      expect(state.launch!.peerUserId, 'friend-3');
      expect(state.launch!.role, DirectCallLaunchRole.caller);
      expect(state.launch!.callId, 'call-3');
    });

    test('a callee decline clears the ring and surfaces a toast', () {
      final socket = _FakeSocket();
      final c = _container(socket);
      c.read(directCallControllerProvider);

      c.read(directCallControllerProvider.notifier)
          .placeCall('friend-4', MatchType.video);
      socket.declined!(const CallResponsePayload(callId: 'call-4'));

      final state = c.read(directCallControllerProvider);
      expect(state.hasRing, isFalse);
      expect(state.toast, isNotNull);
    });

    test('call:end clears any active ring', () {
      final socket = _FakeSocket();
      final c = _container(socket);
      c.read(directCallControllerProvider);

      c.read(directCallControllerProvider.notifier)
          .placeCall('friend-5', MatchType.voice);
      socket.ended!(const CallResponsePayload(callId: 'call-5'));

      expect(c.read(directCallControllerProvider).hasRing, isFalse);
    });
  });

  group('PendingDirectCall — roulette hand-off (one-shot)', () {
    test('set records a launch; consume returns it once then null', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final notifier = c.read(pendingDirectCallProvider.notifier);

      expect(c.read(pendingDirectCallProvider), isNull);
      expect(notifier.consume(), isNull);

      const launch = DirectCallLaunch(
        type: MatchType.video,
        peerUserId: 'friend-9',
        role: DirectCallLaunchRole.callee,
        callId: 'call-9',
      );
      notifier.set(launch);
      expect(c.read(pendingDirectCallProvider), launch);

      // Drained exactly once: the second read yields null so a re-running
      // initState can't replay the hand-off into a second call.
      expect(notifier.consume(), same(launch));
      expect(c.read(pendingDirectCallProvider), isNull);
      expect(notifier.consume(), isNull);
    });
  });
}
