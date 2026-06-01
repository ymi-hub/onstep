const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:3001/setup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/health_setup.png' });
  console.log('Setup page loaded');

  // Find health routine card
  const cards = await page.$$('button');
  let healthCard = null;
  for (const card of cards) {
    const text = await card.textContent();
    if (text && text.includes('건강 루틴')) { healthCard = card; break; }
  }
  
  if (healthCard) {
    await healthCard.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/health_view.png' });
    console.log('Health view opened');

    // Click add button
    const addBtn = await page.$('button:has-text("+ 새 루틴 추가")');
    if (addBtn) {
      await addBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: '/tmp/health_form.png' });
      console.log('Form opened');

      // Check time input
      const timeInput = await page.$('input[type="time"]');
      console.log('Time input found:', !!timeInput);
      if (timeInput) {
        const timeVal = await timeInput.inputValue();
        console.log('Time input value:', timeVal);
        // Try to set time
        await timeInput.fill('09:00');
        await page.waitForTimeout(300);
        const newVal = await timeInput.inputValue();
        console.log('Time after fill:', newVal);
      }

      // Check desc input
      const descInput = await page.$('input[placeholder*="내용 입력"]');
      console.log('Desc input found:', !!descInput);
      if (descInput) {
        await descInput.fill('30분 러닝');
        await page.waitForTimeout(200);
      }

      // Check add button
      const entryAddBtn = await page.$('button:has-text("추가")');
      console.log('Entry add button found:', !!entryAddBtn);
      if (entryAddBtn && timeInput && descInput) {
        await entryAddBtn.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: '/tmp/health_after_add.png' });
        // Check if entry appeared
        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log('Entry "09:00" in page:', bodyText.includes('09:00'));
        console.log('Entry "러닝" in page:', bodyText.includes('러닝'));
      }
    }
  } else {
    console.log('Health card NOT found');
    const allBtns = await page.$$eval('button', bs => bs.map(b => b.textContent?.trim().substring(0, 30)));
    console.log('Available buttons:', allBtns.slice(0, 10));
  }

  console.log('Errors:', errors.filter(e => !e.includes('Geolocation')));
  await b.close();
})();
