// synthetic Agent Bridge source (fixture): MISSING didConnectCore + willWarmModels/didWarmModels emit sites
export function activate(ctx) {
    performance.mark('code/flauz/willActivateBridge');
    performance.mark('code/flauz/willConnectCore');
    // handshake completion mark never emitted (drift class R6)
    performance.mark('code/flauz/willRegisterParticipants');
    performance.mark('code/flauz/didRegisterParticipants');
    performance.mark('code/flauz/didActivateBridge');
}
