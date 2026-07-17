export interface AnimationConfig {
  keyframes: Keyframe[];
  timing: KeyframeAnimationOptions;
}

export const ringEntranceAnimation: AnimationConfig = {
  keyframes: [
    { transform: 'scale(0.3)', opacity: '0' },
    { transform: 'scale(1.05)', opacity: '1', offset: 0.8 },
    { transform: 'scale(1.0)', opacity: '1' },
  ],
  timing: { duration: 250, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' },
};

export const ringExitAnimation: AnimationConfig = {
  keyframes: [
    { transform: 'scale(1.0)', opacity: '1' },
    { transform: 'scale(0.9)', opacity: '0' },
  ],
  timing: { duration: 200, easing: 'ease-in', fill: 'forwards' },
};

export function getBubbleEntranceAnimation(bubbleIndex: number): AnimationConfig {
  return {
    keyframes: [
      { transform: 'scale(0)', opacity: '0' },
      { transform: 'scale(1)', opacity: '1' },
    ],
    timing: { duration: 200, delay: 50 + bubbleIndex * 30, easing: 'ease-out', fill: 'forwards' },
  };
}

export function getBubbleExitAnimation(scatterAngle: number): AnimationConfig {
  const d = 12;
  const dx = Math.cos(scatterAngle) * d;
  const dy = Math.sin(scatterAngle) * d;
  return {
    keyframes: [
      { transform: 'scale(1) translate(0px, 0px)', opacity: '1' },
      { transform: `scale(0.8) translate(${dx}px, ${dy}px)`, opacity: '0' },
    ],
    timing: { duration: 180, easing: 'ease-in', fill: 'forwards' },
  };
}

export const bubbleSelectAnimation: AnimationConfig = {
  keyframes: [{ transform: 'scale(1.15)' }, { transform: 'scale(0.95)' }],
  timing: { duration: 100, easing: 'ease-in', fill: 'forwards' },
};

// Memory-safe WAAPI runner: commits styles then cancels to prevent leaks
export async function runAnimation(el: Element, config: AnimationConfig): Promise<void> {
  const anim = el.animate(config.keyframes, config.timing);
  await anim.finished;
  anim.commitStyles();
  anim.cancel();
}

export async function runBubbleEntranceAll(bubbleEls: Element[]): Promise<void> {
  const anims = bubbleEls.map((el, i) => {
    const cfg = getBubbleEntranceAnimation(i);
    return el.animate(cfg.keyframes, cfg.timing);
  });
  await anims[anims.length - 1].finished;
  anims.forEach((a) => { a.commitStyles(); a.cancel(); });
}

export async function runBubbleExitAll(bubbleEls: Element[], scatterAngles: number[]): Promise<void> {
  const anims = bubbleEls.map((el, i) => {
    const cfg = getBubbleExitAnimation(scatterAngles[i]);
    return el.animate(cfg.keyframes, cfg.timing);
  });
  await Promise.all(anims.map((a) => a.finished));
  anims.forEach((a) => { a.commitStyles(); a.cancel(); });
}
