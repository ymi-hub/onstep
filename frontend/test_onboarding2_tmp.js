const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] }
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('onstep_onboarded'));
  await page.reload({ waitUntil: 'networkidle' });

  // Wait longer for animations to complete
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/slide1_animated.png' });
  console.log('Slide 1 (animated) captured');

  // Check what's actually visible
  const slide1Check = await page.evaluate(() => {
    const img = document.querySelector('img[alt="OnStep 캐릭터"]');
    const textDivs = Array.from(document.querySelectorAll('div')).filter(d =>
      d.textContent && d.textContent.trim() === 'ONSTEP'
    );
    const allDivStyles = img ? {
      parentDisplay: window.getComputedStyle(img.parentElement).display,
      parentOpacity: window.getComputedStyle(img.parentElement).opacity,
      parentVisibility: window.getComputedStyle(img.parentElement).visibility,
      imgDisplay: window.getComputedStyle(img).display,
      imgOpacity: window.getComputedStyle(img).opacity,
      imgWidth: img.getBoundingClientRect().width,
      imgHeight: img.getBoundingClientRect().height,
      imgTop: img.getBoundingClientRect().top,
      imgLeft: img.getBoundingClientRect().left,
    } : null;
    
    // Find text container
    const onStepText = document.evaluate("//div[text()='ONSTEP']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    const textStyle = onStepText ? {
      opacity: window.getComputedStyle(onStepText.parentElement).opacity,
      transform: window.getComputedStyle(onStepText.parentElement).transform,
      visibility: window.getComputedStyle(onStepText.parentElement).visibility,
    } : null;

    return {
      imgDetails: allDivStyles,
      textContainerStyle: textStyle,
      onstepTextFound: !!onStepText,
    };
  });
  console.log('=== SLIDE 1 VISIBILITY CHECK ===');
  console.log(JSON.stringify(slide1Check, null, 2));

  // Now test swipe navigation
  await page.evaluate(() => localStorage.removeItem('onstep_onboarded'));
  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Test swipe gesture
  await page.touchscreen.tap(195, 422); // first touch
  // Simulate swipe left
  const startX = 300, endX = 100, y = 400;
  await page.mouse.move(startX, y);
  // Use touch events for swipe
  await page.evaluate((s, e, y) => {
    const ts = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: document.body, clientX: s, clientY: y })],
      bubbles: true
    });
    const te = new TouchEvent('touchend', {
      changedTouches: [new Touch({ identifier: 1, target: document.body, clientX: e, clientY: y })],
      bubbles: true
    });
    document.dispatchEvent(ts);
    document.dispatchEvent(te);
  }, startX, endX, y);
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/slide2_swipe.png' });
  console.log('Slide 2 via swipe captured');

  // ─── Check progress dots styling ───
  const dotsInfo = await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div'));
    const pills = allDivs.filter(d => {
      const s = window.getComputedStyle(d);
      return s.height === '3px' && s.borderRadius !== '0px';
    });
    return pills.map(p => ({
      width: window.getComputedStyle(p).width,
      background: window.getComputedStyle(p).background,
      opacity: window.getComputedStyle(p).opacity,
    }));
  });
  console.log('=== PROGRESS DOTS ===');
  console.log(JSON.stringify(dotsInfo, null, 2));

  // ─── Check start button on slide 3 ───
  const nextBtn = await page.$('button:has-text("›")');
  if (nextBtn) await nextBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/slide3_final.png' });

  const startBtnCheck = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const startBtn = btns.find(b => b.textContent.includes('시작하기'));
    if (!startBtn) return null;
    const rect = startBtn.getBoundingClientRect();
    const style = window.getComputedStyle(startBtn);
    return {
      text: startBtn.textContent.trim(),
      top: rect.top, bottom: rect.bottom,
      left: rect.left, right: rect.right,
      width: rect.width, height: rect.height,
      opacity: style.opacity,
      isVisible: rect.width > 0 && rect.height > 0,
      overlapsBottomNav: rect.bottom > window.innerHeight - 50,
    };
  });
  console.log('=== START BUTTON ===');
  console.log(JSON.stringify(startBtnCheck, null, 2));

  // Check if going back from slide 3 is possible (prev button check)
  const prevCheck = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map(b => ({ text: b.textContent.trim().substring(0, 30), visible: b.offsetWidth > 0 }));
  });
  console.log('=== BUTTONS ON SLIDE 3 ===');
  console.log(JSON.stringify(prevCheck, null, 2));

  // Test "already onboarded" redirect
  await page.evaluate(() => localStorage.setItem('onstep_onboarded', '1'));
  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const urlAfterOnboarded = page.url();
  console.log('Already onboarded → redirects to:', urlAfterOnboarded);

  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : 'None');

  await browser.close();
  process.exit(0);
})();
