// Live sound effects: "Slowed + reverb", "Nightcore" and "8D audio", applied to whatever is playing.
//
// Speed changes use the media element itself (playbackRate with the pitch following, like a record
// played at the wrong speed, which is exactly what these edits are). Reverb and the circling 8D
// effect run through the Web Audio API. That graph is only built the first time an effect is used,
// so normal playback is untouched for anyone who never opens the menu.

export const EFFECTS = [
  { id: 'normal', name: 'Normal', hint: 'As recorded' },
  { id: 'slowed', name: 'Slowed + Reverb', hint: 'Dreamy, slower and deeper', rate: 0.85, reverb: 0.45 },
  { id: 'nightcore', name: 'Nightcore', hint: 'Faster and higher', rate: 1.25 },
  { id: '8d', name: '8D Audio', hint: 'Sound circles your head · use headphones', reverb: 0.2, orbit: true },
];

export const effectById = (id) => EFFECTS.find((e) => e.id === id) || EFFECTS[0];

/** True if this effect needs the Web Audio graph (reverb / panning), not just a speed change. */
export const needsGraph = (effect) => !!(effect.reverb || effect.orbit);

// a few seconds of decaying noise is all a convincing room reverb needs
function impulse(ctx, seconds = 3.2, decay = 2.6) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

export class SoundFx {
  constructor(media) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.source = ctx.createMediaElementSource(media);

    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx);
    this.panner = ctx.createStereoPanner();
    this.master = ctx.createGain();

    // source ─┬─ dry ────────────┬─ panner ─ master ─ speakers
    //         └─ reverb ─ wet ───┘
    this.source.connect(this.dry).connect(this.panner);
    this.source.connect(this.reverb).connect(this.wet).connect(this.panner);
    this.panner.connect(this.master).connect(ctx.destination);

    // 8D: a slow oscillator sweeps the sound from ear to ear (about once every 8 seconds)
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.125;
    this.depth = ctx.createGain();
    this.depth.gain.value = 0;
    this.lfo.connect(this.depth).connect(this.panner.pan);
    this.lfo.start();

    this.apply(effectById('normal'));
  }

  apply(effect) {
    const t = this.ctx.currentTime;
    const ramp = (param, value) => {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(value, t, 0.15);
    };
    const wet = effect.reverb || 0;
    ramp(this.wet.gain, wet);
    ramp(this.dry.gain, 1 - wet * 0.35);
    ramp(this.depth.gain, effect.orbit ? 0.9 : 0);
  }

  setVolume(volume, muted) {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.03);
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
}
