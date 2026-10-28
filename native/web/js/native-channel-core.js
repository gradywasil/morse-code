let nextSession = Date.now() * 1000;
const sessionId = () => ++nextSession;
const observed = promise => { promise.catch(() => {}); return promise; };

export function createNativeTorchChannel(plugin) {
  const listeners = new Map();
  const emit = (name, payload) => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };
  let session = 0;
  let acquired = false;
  let lit = false;
  let pending = null;
  const lostListener = plugin.addListener('hardwareLost', event => {
    if (event.source === 'flashlight' && event.session === session && acquired) {
      acquired = false;
      lit = false;
      emit('lost', { code: 'apply-rejected', detail: event.detail });
    }
  });

  function release() {
    const old = session;
    session = 0;
    acquired = false;
    lit = false;
    pending = null;
    if (old) plugin.releaseFlashlight({ session: old }).catch(() => {});
    emit('released', {});
  }

  async function command(method, data) {
    const current = session;
    if (!acquired) throw new Error('Flashlight is not enabled');
    try {
      await plugin[method]({ session: current, ...data });
      return current;
    } catch (error) {
      if (current === session && acquired) {
        acquired = false;
        lit = false;
        emit('lost', { code: 'apply-rejected', detail: error.message });
      }
      throw error;
    }
  }

  return {
    acquire() {
      if (acquired) return Promise.resolve({ outcome: 'torch-ready', form: 'native' });
      if (pending) return pending;
      const current = session = sessionId();
      const attempt = plugin.acquireFlashlight({ session: current }).then(result => {
        if (session !== current) return { outcome: 'error', reason: 'cancelled' };
        if (result.ok) {
          acquired = true;
          return { outcome: 'torch-ready', form: 'native' };
        }
        return { outcome: 'screen-fallback', reason: result.outcome === 'permission-denied'
          ? 'permission-denied' : 'no-torch-capability' };
      }).catch(error => ({ outcome: 'error', reason: 'internal', detail: error.message }))
        .finally(() => { if (session === current) pending = null; });
      pending = attempt;
      return attempt;
    },
    on: () => observed(command('setFlashlight', { on: true }).then(current => { if (session === current) lit = true; })),
    off: () => observed(command('setFlashlight', { on: false }).then(current => { if (session === current) lit = false; })),
    scheduleTimeline: data => observed(command('scheduleFlashlight', data)),
    release,
    async destroy() { release(); (await lostListener).remove(); },
    isLit: () => lit,
    status: () => ({ supported: true, acquired, state: acquired ? 'torch-ready' : 'idle', form: 'native' }),
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
  };
}

export function createNativeFrameSource(plugin, video, env = window) {
  let session = 0;
  let handles = [];
  let offset = null;
  let observer = null;
  let positionPending = false;
  const rect = () => {
    const box = video.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height, scale: env.devicePixelRatio };
  };
  function position() {
    if (!session || positionPending) return;
    positionPending = true;
    env.requestAnimationFrame(() => {
      positionPending = false;
      if (session) plugin.positionPreview({ session, ...rect() }).catch(() => {});
    });
  }
  function stop() {
    const old = session;
    session = 0;
    offset = null;
    for (const handle of handles) Promise.resolve(handle.remove()).catch(() => {});
    handles = [];
    observer?.disconnect();
    env.removeEventListener('resize', position);
    env.removeEventListener('scroll', position, true);
    video.style.visibility = '';
    if (old) return plugin.stopReceiver({ session: old });
  }
  return {
    async start(onFrame, onLost) {
      Promise.resolve(stop()).catch(() => {});
      const current = session = sessionId();
      const registered = await Promise.all([
        plugin.addListener('cameraFrame', frame => {
          if (session !== current || frame.session !== current) return;
          if (offset === null) offset = env.performance.now() - frame.tMs;
          onFrame({ ...frame, tMs: frame.tMs + offset });
        }),
        plugin.addListener('hardwareLost', event => {
          if (session === current && event.session === current && event.source === 'camera') onLost(event);
        }),
      ]);
      if (session !== current) {
        registered.forEach(handle => handle.remove());
        return { ok: false, outcome: 'cancelled' };
      }
      handles = registered;
      let result;
      try { result = await plugin.startReceiver({ session: current, ...rect() }); }
      catch (error) { if (session === current) Promise.resolve(stop()).catch(() => {}); throw error; }
      if (session !== current) return { ok: false, outcome: 'cancelled' };
      if (!result.ok) { Promise.resolve(stop()).catch(() => {}); return result; }
      video.style.visibility = 'hidden';
      observer = new env.ResizeObserver(position);
      observer.observe(video);
      env.addEventListener('resize', position);
      env.addEventListener('scroll', position, true);
      position();
      return result;
    },
    stop,
  };
}
