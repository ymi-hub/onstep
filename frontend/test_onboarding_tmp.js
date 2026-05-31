const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // Clear localStorage to ensure onboarding shows
    storageState: { cookies: [], origins: [] }
  });

  const page = await context.newPage();
  
  // Collect console errors
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));

  // Navigate to onboarding
  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  
  // Clear any existing onboarding flag
  await page.evaluate(() => localStorage.removeItem('onstep_onboarded'));
  await page.reload({ waitUntil: 'networkidle' });

  await page.screenshot({ path: '/tmp/slide1.png', fullPage: false });
  console.log('SLIDE 1 captured');

  // Check slide 1 content
  const slide1Text = await page.evaluate(() => document.body.innerText);
  console.log('=== SLIDE 1 TEXT ===\n' + slide1Text.substring(0, 500));

  // Check SKIP button
  const skipBtn = await page.$('button:has-text("SKIP")');
  console.log('SKIP button found:', !!skipBtn);

  // Check next button (›)
  const nextBtn = await page.$('button:has-text("›")');
  console.log('Next button found:', !!nextBtn);

  // Click next → Slide 2
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/slide2.png' });
    console.log('SLIDE 2 captured');

    const slide2Text = await page.evaluate(() => document.body.innerText);
    console.log('=== SLIDE 2 TEXT ===\n' + slide2Text.substring(0, 500));
  }

  // Click next → Slide 3
  const nextBtn2 = await page.$('button:has-text("›")');
  if (nextBtn2) {
    await nextBtn2.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/slide3.png' });
    console.log('SLIDE 3 captured');

    const slide3Text = await page.evaluate(() => document.body.innerText);
    console.log('=== SLIDE 3 TEXT ===\n' + slide3Text.substring(0, 600));
  }

  // Check start button
  const startBtn = await page.$('button:has-text("OnStep 시작하기")');
  console.log('Start button found:', !!startBtn);

  // Test SKIP on slide 1 (go back, then skip)
  await page.evaluate(() => localStorage.removeItem('onstep_onboarded'));
  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const skipBtn2 = await page.$('button:has-text("SKIP")');
  if (skipBtn2) {
    await skipBtn2.click();
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    console.log('After SKIP, URL:', finalUrl);
    const onboarded = await page.evaluate(() => localStorage.getItem('onstep_onboarded'));
    console.log('localStorage onstep_onboarded after SKIP:', onboarded);
  }

  // --- Layout/UX analysis ---
  await page.evaluate(() => localStorage.removeItem('onstep_onboarded'));
  await page.goto('http://localhost:3001/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const uiAnalysis = await page.evaluate(() => {
    const results = {};
    
    // Bottom nav visible?
    const bottomNav = document.querySelector('nav');
    results.bottomNavVisible = bottomNav ? window.getComputedStyle(bottomNav).display !== 'none' : false;

    // Progress dots
    const dots = document.querySelectorAll('[style*="border-radius: 2px"]');
    results.dotsCount = dots.length;

    // Slide container
    const slideTrack = document.querySelector('[style*="300%"]');
    results.slideTrackFound = !!slideTrack;
    
    // Overall page height
    results.pageHeight = document.documentElement.clientHeight;
    results.pageWidth = document.documentElement.clientWidth;

    // Any overflow issues
    results.bodyOverflow = window.getComputedStyle(document.body).overflow;
    
    // Check if logo image loads
    const logoImg = document.querySelector('img[alt="OnStep 캐릭터"]');
    results.logoImgFound = !!logoImg;
    results.logoImgSrc = logoImg ? logoImg.src : null;
    results.logoImgComplete = logoImg ? logoImg.complete : false;
    results.logoImgNaturalWidth = logoImg ? logoImg.naturalWidth : 0;
    
    return results;
  });
  
  console.log('=== UI ANALYSIS ===');
  console.log(JSON.stringify(uiAnalysis, null, 2));
  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : 'None');

  await browser.close();
})();
