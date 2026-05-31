const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox']
  });

  // Enable touch support
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: { cookies: [], origins: [] }
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('onstep_onboarded'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // ── Test 1: Swipe left → go to slide 2
  await page.touchscreen.tap(195, 400);
  await page.evaluate(() => {
    const el = document.documentElement;
    const ts = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: el, clientX: 300, clientY: 400 })],
      bubbles: true
    });
    el.dispatchEvent(ts);
  });
  await page.evaluate(() => {
    const el = document.documentElement;
    const te = new TouchEvent('touchend', {
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: 80, clientY: 400 })],
      bubbles: true
    });
    el.dispatchEvent(te);
  });
  await page.waitForTimeout(700);
  const curSlide = await page.evaluate(() => {
    const track = document.querySelector('[style*="300%"]');
    if (!track) return 'not found';
    return track.style.transform;
  });
  console.log('After swipe left, track transform:', curSlide);
  await page.screenshot({ path: '/tmp/after_swipe.png' });

  // ── Test 2: Swipe right → go back to slide 1
  await page.evaluate(() => {
    const el = document.documentElement;
    el.dispatchEvent(new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 2, target: el, clientX: 80, clientY: 400 })],
      bubbles: true
    }));
    el.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [new Touch({ identifier: 2, target: el, clientX: 300, clientY: 400 })],
      bubbles: true
    }));
  });
  await page.waitForTimeout(700);
  const afterSwipeBack = await page.evaluate(() => {
    const track = document.querySelector('[style*="300%"]');
    return track ? track.style.transform : 'not found';
  });
  console.log('After swipe right (back), track transform:', afterSwipeBack);

  // ── Test 3: Navigate to slide 3 and check start button
  await page.click('button:has-text("›")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("›")');
  await page.waitForTimeout(800);

  const startBtnAnalysis = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const startBtn = btns.find(b => b.textContent.includes('시작하기'));
    if (!startBtn) return null;
    const rect = startBtn.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      height: Math.round(rect.height),
      opacity: parseFloat(window.getComputedStyle(startBtn).opacity),
      outOfViewport: rect.bottom > window.innerHeight || rect.top < 0,
      bottomClearance: window.innerHeight - rect.bottom,
    };
  });
  console.log('Start button position:', JSON.stringify(startBtnAnalysis, null, 2));

  // Check for "going back" from slide 3 (no prev button exists)
  const allBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().replace(/\s+/g,' ').substring(0,30))
  );
  console.log('Buttons visible on slide 3:', allBtns);

  await page.screenshot({ path: '/tmp/slide3_check.png' });

  // ── Test 4: After "시작하기", where does it go?
  await page.click('button:has-text("시작하기")');
  await page.waitForTimeout(1500);
  const finalUrl = page.url();
  const finalOnboarded = await page.evaluate(() => localStorage.getItem('onstep_onboarded'));
  console.log('After 시작하기 → URL:', finalUrl);
  console.log('localStorage flag:', finalOnboarded);
  await page.screenshot({ path: '/tmp/after_start.png' });

  // ── Test 5: Revisit /onboarding when already onboarded
  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const redirectedUrl = page.url();
  console.log('Revisit onboarding → redirected to:', redirectedUrl);

  await browser.close();
  process.exit(0);
})();
