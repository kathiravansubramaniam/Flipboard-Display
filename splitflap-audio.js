/**
 * Split-flap style SFX: sine + bandpassed noise, dry/wet reverb, cascade helper.
 */
export class SplitFlapAudio {
    constructor({ sharpness = 0.1, reverbMix = 0.85 } = {}) {
        this.sharpness = sharpness;
        this.reverbMix = Math.min(1, Math.max(0, reverbMix));
        this.ctx = null;
        this.bus = null;
        this.master = null;
        this.dryGain = null;
        this.wetGain = null;
        this.convolver = null;
        this.comp = null;
        this._noiseBuf = null;
        this._initialized = false;
    }

    _qFromSharpness() {
        return 0.4 + this.sharpness * 12;
    }

    _makeIR(ctx) {
        const dur = 0.35;
        const len = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const ch = buf.getChannelData(c);
            for (let i = 0; i < len; i++) {
                ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
            }
        }
        buf.getChannelData(0)[0] = 0.35;
        buf.getChannelData(1)[0] = 0.3;
        return buf;
    }

    _makeNoise(ctx) {
        const len = Math.floor(ctx.sampleRate * 0.15);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    _applyMix() {
        if (!this.dryGain || !this.wetGain) return;
        const w = this.reverbMix;
        this.dryGain.gain.value = 1 - w;
        this.wetGain.gain.value = w;
    }

    async init() {
        if (this._initialized) {
            if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;

        this.ctx = new AC();
        this.bus = this.ctx.createGain();
        this.bus.gain.value = 1;

        this.master = this.ctx.createGain();
        this.master.gain.value = 1;

        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = this._makeIR(this.ctx);

        this.dryGain = this.ctx.createGain();
        this.wetGain = this.ctx.createGain();
        this._applyMix();

        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.knee.value = 8;
        this.comp.ratio.value = 2.5;

        this.bus.connect(this.dryGain);
        this.bus.connect(this.convolver);
        this.convolver.connect(this.wetGain);
        this.dryGain.connect(this.comp);
        this.wetGain.connect(this.comp);
        this.comp.connect(this.master);
        this.master.connect(this.ctx.destination);

        this._noiseBuf = this._makeNoise(this.ctx);

        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this._initialized = true;
    }

    /**
     * Single mechanical flap click (top or bottom half).
     */
    playClick() {
        if (!this.ctx || !this.bus) return;

        const run = () => {
            if (this.ctx.state !== 'running') return;
            const t0 = this.ctx.currentTime;
            const ctx = this.ctx;

            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, t0);

            const ns = ctx.createBufferSource();
            ns.buffer = this._noiseBuf;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(3000, t0);
            bp.Q.setValueAtTime(this._qFromSharpness(), t0);

            const oscMix = ctx.createGain();
            oscMix.gain.value = 0.52;
            const noiseMix = ctx.createGain();
            noiseMix.gain.value = 0.48;

            const env = ctx.createGain();
            env.gain.setValueAtTime(0.0001, t0);
            env.gain.linearRampToValueAtTime(0.22, t0 + 0.0018);
            env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);

            osc.connect(oscMix);
            oscMix.connect(env);
            ns.connect(bp);
            bp.connect(noiseMix);
            noiseMix.connect(env);
            env.connect(this.bus);

            const tail = 0.07;
            osc.start(t0);
            osc.stop(t0 + tail);
            ns.start(t0);
            ns.stop(t0 + tail);
        };

        if (this.ctx.state === 'suspended') {
            this.ctx.resume().then(run).catch(() => {});
        } else {
            run();
        }
    }

    /**
     * Staggered clicks across columns at a given frame rate (e.g. 6 cols @ 11 fps).
     */
    async triggerCascade(columns, fps) {
        if (!this._initialized) await this.init();
        if (!this.ctx) return;
        const interval = 1000 / fps;
        for (let i = 0; i < columns; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, interval));
            this.playClick();
        }
    }

    setOutputLevel(level) {
        if (!this._initialized || !this.master || !this.ctx) return;
        const t = this.ctx.currentTime;
        const v = Math.max(0, Math.min(1, level));
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(this.master.gain.value, t);
        this.master.gain.linearRampToValueAtTime(v, t + 0.06);
    }
}
