// synthetic Agent Bridge source (fixture): emits every budgeted code/flauz/* mark
export function activate(ctx) {
    performance.mark('code/flauz/willActivateBridge');
    performance.mark('code/flauz/willConnectCore');
    // ... handshake ...
    performance.mark('code/flauz/didConnectCore');
    performance.mark('code/flauz/willRegisterParticipants');
    // ... register chat participant ...
    performance.mark('code/flauz/didRegisterParticipants');
    performance.mark('code/flauz/willWarmModels');
    // ... selectChatModels pre-warm ...
    performance.mark('code/flauz/didWarmModels');
    performance.mark('code/flauz/didActivateBridge');
}
