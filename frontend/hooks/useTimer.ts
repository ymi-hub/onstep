'use client';

import { useState, useEffect, useRef } from 'react';

/** ms → "M:SS" 포맷 */
export function formatTimerRemain(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Web Audio API로 3음 차임 합성 (포그라운드용 보조) */
export function playAlarmChime(ctx: AudioContext) {
  try {
    const notes = [880, 1046, 1318];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.45, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  } catch {
    // 사운드 미지원 환경 무시
  }
}

// 맑고 선명한 3톤 알람 벨 사운드 WAV (Base64) - 1.0초 8000Hz 8-bit Mono PCM
const ALARM_SOUND_WAV = "data:audio/wav;base64,UklGRmQfAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAfAACAqL63l2xKQVR8pb25mnBNQVJ4obu6nnRPQU90nrm7oXhSQU1wmri8pHxVQktslra8p39YQ0ppkrO8qYNcREhmj7G8rIdfRkdii668rotiR0Zfh6u8sI5mSUVcg6i7spJqS0VagKW6tJVtTUVXfKK5tZlxUEVVeJ+3tpx1UkVSdZy2t594VUVQcZi0uKJ8WEZPbpWyuKSAW0dNapGwuKeDXkhMZ46uuKmHYUpLZIqruKuKZEtKYYeouK2NaE1JX4Omt6+Ra09JXICjtrCUblFJWnygtbGXclNJV3mdtLKadVVJVXWasrOdeVhJVHKXsLSffFtKUm+Tr7Sif11LUWyQrbSkg2BMT2mNqrSmhmNNTmaJqLSoiWZPTmOGprSqjGlQTWGDo7OrkGxSTV9/oLKtknBUTVx8nrGulXNWTVp5m7CvmHZYTVl2mK6vmnlbTVdzla2wnXxdTlVwkquwn4BgT1Rtj6mwoYNjUFNrjKewo4ZlUVJoiaWwpYloUlFmhqOwp4trVFFjg6CvqI5uVlFhgJ6uqZFxV1FffZutqpR0WVFdepmsq5Z3XFFcd5arrJh6XlFadJOprJt9YFJZcZCorJ1/YlNYb46mrZ+CZVRXbIukrKCFZ1VWaoiirKKIalZVaIWgrKOKbVhVZoKeq6WNb1lVZICbqqaQcltUYn2ZqaeSdV1VYHqWqKeUd19VX3iUp6iWemFVXXWRpqiYfWNWXHOPpKmaf2VXW3CMoqmcgmdYWm6KoaidhWpZWmyHn6ifh2xaWWqFnaigim5bWWiCm6ehjHFdWGZ/maaijnNeWGV9l6ajkHZgWWN7lKSkknhiWWJ4kqOklHtkWWF2kKKkln1lWl90jaGlmH9nW19yi5+lmYJqW15wiZ6kmoRsXF1uhpyknIZuXl1shJqknYlwX1xqgpijnotyYFxpf5ajn411YlxnfZSin453Y1xme5KhoJB5ZV1leZCgoJJ7Zl1kd46eoZR9aF5jdYydoZV/al5ic4qcoZaCbF9hcYiaoZiEbmBhcIaZoJmGcGFhboSXoJqIcmJgbYKVn5uJdGRga4CUn5uLdmVgan6SnpyNeGZgaXyQnZyOemhhaHqOnJ2QfGlhZ3iMm52RfmtiZnaLmp2Sf21iZnWJmJ2UgW5jZXOHl52Vg3BkZXKFlpyWhXJlZHCDlJyWh3NmZG+Bk5uXiHVnZG6AkZuYindoZG1+kJqYi3lqZGx8jpmZjHprZWt6jJiZjnxsZWp5i5eZj35uZmp3iZaZkH9vZml2h5WZkYFxZ2l1hpSZkoNyaGhzhJOYk4R0aWhyg5GYk4Z1amhxgZCXlId3a2hwgI+XlIh4bGhvfo2WlYl6bWhvfYyVlYt7bmlue4qVlYx9b2lteomUlY1+cGpteYiTlY1/cmpseIaSlY6Bc2tsdoWRlY+CdGtsdYOQlJCDdmxsdIKOlJCFd21sdIGNk5CGeG5sc4CMk5GHeW9scn6LkpGIe3Bscn2KkpGJfHFtcXyJkZGJfXJtcXuHkJGKfnNucHqGj5GLf3RucHmFjpGMgXVvcHiEjZGMgnZvcHeDjZCMg3dwcHeCjJCNhHlxcHaBi5CNhHpxcHV/io+NhXtycHV/iY6NhnxzcHR+iI6Nh310cXR9h42Nh351cXR8hoyNiH92cXR7hYyNiIB3cnN6hIuNiYB4cnN6g4qNiYF4c3N5gomMiYJ5dHN5gYmMioN6dHR4gIiMioN7dXR4gIeLioR8dnR4f4aLioR9dnR3foWKioV9d3V3fYWKioV+eHV3fYSJioZ/eHV3fIOIiYZ/eXZ3fIOIiYaAenZ3e4KHiYaBe3d3e4GGiIaBe3d3e4GGiIaCfHh3e4CFiIaCfXh4en+Fh4aCfXl4en+Eh4aDfnp4en+DhoaDfnp5en6DhoaDf3t5en6ChYaDf3t5en6ChYWDgHx6en2BhIWDgHx6e32BhIWDgH17e32Ag4SDgH17e32Ag4SDgX57e32AgoSDgX58fH2AgoODgX58fH1/goODgX99fH1/gYOCgX99fX1/gYKCgX9+fX1/gYKCgX9+fX5/gIGCgX9+fn5/gIGBgYB/fn5/gIGBgIB/fn5/gICAgIB/f39/gICAgIB/f39/gICAgIB/f39/gK6/p3ZLQmCSuLqXZURJcaK9sYVWQVSDsL2kc0pDY5W5uJRiQ0t0pL2uglRCV4axvKFwSUVml7m2kGBETninvKt+UkNaibK6nW1JR2qaubSNXURQe6i8qHtRRF6Ms7maakhKbZ25sYlbRFN+qruleFBGYY+0t5doSExxn7mvhllFVoKsuaJ1TkdkkrS1k2VITnShuayDWEZZha24n3JOSWeVtbOQY0hRd6O4qYBWR1yIrrecb01Lape1sI1hSFN6pbemfVVIX4qvtZltTU1umrWuil9JVn2mtqN6VEpijbCzlmpMT3GctayHXUlYgKi1oXdTS2WQsLGTaExRdJ60qYRbSluDqbSedFJNaJKwr5BmTFR3oLSngVpLXoaqs5tyUU9rlbGtjWRNVnqhs6R+WUxhiauxmG9RUG6XsauKYk1YfaOyoXtYTmSLq7CVbVFScZmwqYdgTlt/pLGfeFdPZo6srpJrUVR0m7CmhF9OXYKlsJx2VlFpkKysj2lRV3ecr6SBXk9ghaavmXRVUmySrKqNZ1FZeZ6von9cUGOHp62XcVVUb5SsqIplUVt8n66ffFtSZYmnrJRvVVZxlqymh2RSXX6grZ16W1NojKiqkW1VWHSXrKSFYlNggaGsmnhaVGqOqKiPa1Vad5mroYJhVGKDoquYdVpWbZCop4xqVVx5mqqfgGBVZYajqZVzWVhvkailimhWXnucqp19X1ZniKOok3FZWXKTqKOHZ1Zgfp2pm3tfV2mKpKaQcFlbdJWnoYVmV2KAnaiYeV5YbIykpY5uWV13lqefg2VYZIKep5Z3XlpujaSjjG1aX3mXpp2AZFlnhJ+llHVdW3CPpKGJa1phe5ilmn5jWmmGn6SRdF1dc5Cjn4dqW2N9maWYfGJba4ifo49yXV91kqOehWlbZX+apJZ6YlxtiqChjXFeYHeTo5yDaFxngZqilHliXm+LoJ+Lb15ieZSimoFnXWmDm6GSd2JfcY2fnoluXmR7laGYf2dea4WboJB2YWFzjp+ch21fZn2WoJZ9Zl9thpufjnRiYnWPn5qFbGBof5aflHxmYG+Im52Mc2Jkd5CemYNrYGmAl56SemZicYmbnIpyYmV5kZ6XgWtha4KXnZB5ZmNzipuaiHFjZ3uSnZWAamJthJecjndmZHSMm5mGcGNpfZKck35qY2+FmJuNdmZmdo2al4VvZGp+k5uSfWpkcYaXmYt1Zmd4jZqWg25lbICTmpB7aWZyh5eYiXRmaXqOmZSCbmZugZSZjnppZ3SIl5eHc2dqe4+ZkoBuZm+ClJiNeWpodomXlYZzaGx9j5iRf21ncYSUl4t4amp3ipaUhHJobX6Ql49+bWlzhZSWiXdqa3mLlpKDcWlvf5CWjnxtanSGk5SIdmtseouVkYJxanCAkJWMe21rdoeTk4d2a257jJSPgHFrcoKQlIt6bmx3h5OShXVsb32MlI5/cWxzg5CTiXpubXiIkpCEdWxwfoyTjX5xbXWDkJKIeW5veoiRj4N0bXJ/jZKLfXFudoSPkId4b3B7iZGOgnRuc4CNkYp9cW93hY+PhXhvcXyJkIyBdG90gYyQiXxxcHiFjo6EeHByfYmPi4B0cHaCjI+He3JxeoaOjYN3cXR+iY6Kf3Rxd4KMjoZ7cnJ7ho2MgndxdX+JjYl+dHJ4g4uMhXpzc3yGjYqBd3J2gImNiH51c3mDi4uEenN1fYaMiYF3c3eAiYyGfXV0eoSKioN6dHZ9houIgHd0eIGJi4V9dnV7hIqJgnp1d36Giod/eHV5gYiKhHx2dnyEiYiCenZ4f4aJhn94dnqCiIiEfHd3fYSIh4F6d3l/hoiFfnh3e4KHh4N8eHh9hIiGgHp3eoCGh4R+eXh8goaGgnx4eX6Eh4WAenh7gIWGg355eX2ChoWBfHl6f4SGhH97eXyAhYWDfnp6fYKFhYF8ent/g4WDf3t6fIGEhIJ+e3t+goSEgH17fH+DhIJ/fHt9gYOEgX58fH6Cg4OAfXx9gIKDgn99fH6Bg4OBfnx9f4GDgoB9fX6AgoKBf319foCCgoB+fX5/gYKBgH5+foCBgYB/fn5/gIGBgH9+fn+AgYB/f35/gICAgH9/f3+AgICAf39/f4CAgH9/f3+AgIC2t4JKR3u0uYZNRXexu4pQRHKuvI9TQ26rvZNWQmqnvpdZQWakvptdQWKgvp9hQV6cvqJlQVuYvaZpQleUvaltQ1SQu6xxRFGMuq91Rk+HuLJ6SEyDtrR+Skp/tLaCTEh6sriHT0Z2r7mLUUVyrLqPVERuqbuTWENqpryXW0NmorybX0NinryfYkNfm7yiZkNbl7ulakRYk7upbkVVj7mrckZSi7iudkhQhraxe0pNgrSzf0xLfrK1g05JerC2h1FIdq24i1NHcqq5j1ZGbqe6k1lFaqS6l11FZqG7m2BEYp27nmRFX5m6omhFXJW6pWtGWZK5qG9HVo64q3NIU4q2rXdKUYW0r3xMToGzsoBOTH2ws4RQS3mutYhSSXWrtoxVSHGot5BYR26luJNbR2qiuZdeRmafuZtiRmObuZ5lRl+YuKFpR1yUuKRtSFmQt6dxSVeMtqp0SlSJtKx4TFKFs658TVCBsbCAT059rrKEUkx5rLSIVEt1qbWMV0pxp7aQWklupLaTXUhqobeXYEhmnbeaY0hjmreeZ0hglrahakldk7akbkpaj7WmcktXi7SpdUxViLKreU5ThLGtfU9RgK+vgVFPfK2xhVROeKqyiFZMdaizjFlLcaW0kFtLbaK1k15Kap+1l2JKZ5y1mmVKY5m1nWhKYJW1oGxLXpK0o29MW46zpXNNWIqyqHZOVoewqnpPVIOvrH5RUn+troJTUHyrr4VVT3iosYlYTnSmsoxaTXGjs5BdTG2gs5NgTGqds5ZjTGeas5pmTGSXs51qTGGUs59tTV6QsqJwTVyNsaV0T1mJsKd3UFeGrql7UVWCrat/U1N/q62CVVJ7qa6GV1B4p6+JWk90pLCNXE5xorGQX05un7GTYk1qnLKWZU1nmbKZaE1klrGca05ik7Gfbk5fj7ChcU9cjK+kdVBaiK6meFJYha2ofFNWgquqf1VUfqmrg1dTe6ethllSd6WuiVtRdKKvjV5QcaCvkGBQbp2wk2NPa5qwlmZPaJewmWlPZZSwnGxQYpGvnm9QYI6uoXNRXYuto3ZSW4ispXlUWYSrp3xVV4GpqIBXVn6nqoNZVHqlq4ZbU3ejrIpdUnShrY1fUnGerpBiUW6crpNlUWuZrpZoUWiWrphqUWWTrpttUmOQrZ1wUmCNrKB0U16Kq6J3VFyHqqR6VlqDqaZ9V1mAp6eAWVd9pamDW1Z6o6qHXVV3oauKX1R0n6uNYVNxnayQZFNumqySZlNrl6yVaVNolayYbFNmkqyab1Njj6udclRhjKqfdVVfiamheFZdhqije1dbg6ekfllagKWmgVtYfaSnhFxXeqKoh15Wd6CpimBWdJ2qjWNVcZuqj2VVbpmqkmhUa5aqlWpVaZOql21VZ5GqmnBVZI6pnHNWYoupnnZXYIiooHhYXoWmontZXYKlo35bW3+kpYFcWnyipoReWXmgp4dgWHeeqIpiV3ScqI1kV3GaqY9nVm6XqZJpVmyVqZRsVmmSqJduV2ePqJlxV2WNp5t0WGOKp512WWGHpp95Wl+EpaB8W16Co6J/XVx/oqOCXlt8oKSEYFp5nqWHYll2nKaKZFl0mqaNZlhxmKePaFhvlqeSalhsk6eUbVhqkaeWb1lojqaYcllmjKaadVpkiaWcd1tihqSeelxhhKOffV1fgaGhf15efqCigmBdfJ6jhWJceZ2kh2NbdpukimVadJmljGdacZelj2pab5SlkWxabZKlk25aa5CllXFaaY2kl3NbZ4ukmXZcZYijm3hdY4ainXteYoOhnn1fYICgn4BgX36eoIJiXnudoYVjXXmboodlXXaZo4pnXHSXo4xpXHKVo45rXG+To5FtXG2Ro5NvXGuOo5VyXGmMo5d0XWiKoph2XWaHoZp5XmSFoJt7X2OCn51+YWKAnp6AYmF+nJ+DY2B7m6CFZV95maCHZ152l6GKaF50lqGMal5ylKKObF1wkqKQbl1ukKGScV5sjaGUc15qi6GWdV9oiaCXd19nh5+ZemBlhJ6afGFkgp2bfmJjgJydgWRifZudg2Vhe5mehWdgeZifh2hgd5afimpfdJSgjGxfcpKgjm5fcJCgkHBfbo6gkXJgbYyfk3Rga4qflXZgaYielnhhaIadmHpiZ4SdmX1jZYGbmn9kZH+am4FlY32ZnINnY3uYnYVoYnmWnYdqYneUnolrYXWTnottYXORno1vYXGPno9xYW+NnpFzYW2LnZJ1YmyJnZR3YmqHnJV5Y2mFnJd7ZGiDm5h9ZWeBmpl/ZmZ/mZqBZ2V9l5qDaGR7lpuFamR5lJyHa2N3k5yJbWN1kZyLb2NzkJyNcGNxjpyOcmNwjJyQdGNuipySdmRtiJuTeGRrhpuUemVqhJqVfGZpgpmWfmdogJiXgGhnf5eYgWlmfZaZg2pme5SahWtleZOah21ld5GaiW5ldZCai3BldI6ajHJlco2ajnNlcYuaj3Vlb4makXdlboeZknlmbIaZk3pna4SYlHxnaoKXlX5oaYCWloBpaX6Vl4JqaHyUl4NsZ3uTmIVtZ3mRmIduZ3eQmYhwZnaPmYpxZnSNmYxzZnOMmY10Z3GKmI52Z3CImJB4Z2+Hl5F5aG6Fl5J7aG2DlpN9aWyBlZR+amuAlJWAa2p+k5WCbGl8kpaDbWl7kZaFbml5kJeHcGh4j5eIcWh2jZeKcmh1jJeLdGhzipeMdWhyiZaOd2lxh5aPeGlwhpaQempvhJWRfGpug5SSfWttgZSSf2xsf5OTgG1sfpKUgm5rfJGUg29re5CVhXBqeY+VhnFqeI2ViHJqd4yViXRqdYuVinVqdImVjHZqc4iVjXhrcoaUjnlrcYWUj3trcISTkHxsb4KTkH5tboGSkX9ubn+RkoFubX6QkoJvbXyPk4NwbHuOk4VxbHqNk4ZybHiMk4d0bHeLk4h1bHaKk4p2bHWIk4t3bHSHk4x5bHOGko16bXKEko57bXGDkY59bnCCkY9+bnCAkJB/b29/j5CBcG9+j5GCcW58jpGDcm57jZGEc256jJGGdG15i5KHdW14ipKIdm13iJGJd252h5GKeG51hpGLem50hZGMe29zhJCMfG9ygpCNfXBygY+OfnBxgI6OgHFxf46PgXJwfo2PgnJwfYyPg3Nve4uQhHRveoqQhXVveYmQhnZveIiQh3dvd4eQiHhvdoaPiXlwdoWPinpwdYSPi3twdIOOi3xxdIKOjH5xc4GNjH9ycoCNjYBzcn+MjYFzcn6LjYJ0cX2LjoN1cXyKjoR2cXuJjoV2cXqIjoZ3cXmHjoZ4cXiGjod5cXeFjoh6cXeEjYl7cnaDjYl8cnWCjYp9c3WCjIp+c3SBjIt/dHSAi4uAdHR/i4yBdXN+ioyCdXN9iYyDdnN8iYyDd3N7iIyEeHN6h4yFeHN6hoyGeXN5hYyGenN4hIyHe3N4hIyIfHR3g4uIfXR3gouJfXR2gYqJfnV2gIqJf3V1f4qKgHZ1f4mKgXZ1foiKgnd1fYiKgnh1fIeKg3h1fIaKhHl1e4aKhHp1eoWKhXp1eoSKhnt1eYSKhnx1eYOKh3x1eIKJh312eIGJh352d4GJiH92d4CIiH93d3+IiIB3d3+HiIF4dn6HiYF4dn2GiYJ5dn2GiYN5dnyFiYN6dnyFiYR7dnuEiYR7d3uDiIV8d3qDiIV8d3qCiIV9d3mCiIZ+d3mBh4Z+eHmAh4Z/eHmAh4d/eHh/hoeAeXh/hoeBeXh+hYeBenh+hYeCenh9hYeCe3h9hIeDe3h8hIeDfHh8g4eDfHh8g4eEfXh7goaEfXl7goaEfnl7gYaEfnl6gYaFf3l6gIWFf3p6gIWFgHp6f4WFgHp6f4SFgHt6foSFgXt6foSFgXx6foOFgnx6fYOFgnx6fYOFgn16fYKFgn16fIKFg316fIGFg356fIGEg357fIGEg397fICEg397fICEg397fICDg4B8e3+DhIB8e3+DhIB8e3+DhIB8e36Cg4F9fH6Cg4F9fH6Cg4F9fH6Cg4F+fH6Bg4F+fH2Bg4J+fH2Bg4J+fH2Ag4J/fH2AgoJ/fX2AgoJ/fX2AgoJ/fX2AgoKAfX1/goKAfX1/goKAfn1/gYKAfn1/gYKAfn1/gYKAfn1/gYKAfn1/gYGAf35/gIGBf35+gIGBf35+gIGBf35+gIGBf35+gIGBf35/gIGAf35/gICAf39/f4CAgH9/f4CAgH9/f4CAgH9/f4CAgH9/f4CAgH9/f4CAgH9/f4CAgH9/f4CAgH9/f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA=="; 

// 2초 무음 WAV (Base64) - 백그라운드 오디오 세션 획득용 (16-bit Mono 8000Hz PCM)
const SILENT_WAV = "data:audio/wav;base64,UklGRmQfAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAfAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

export interface TimerState {
  timerLabel: string | null;
  timerEndMs: number | null;
  timerRemainMs: number;
  alarmVisible: boolean;
  alarmLabel: string | null;
  startTimer: (label: string, minutes: number) => void;
  stopTimer: () => void;
  dismissAlarm: () => void;
}

const TIMER_STORAGE_KEY = 'onstep_timer_v1';

function saveTimerToStorage(label: string, endMs: number, durationMs: number) {
  try {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify({ label, endMs, durationMs }));
  } catch {}
}

function clearTimerFromStorage() {
  try { localStorage.removeItem(TIMER_STORAGE_KEY); } catch {}
}

export function useTimer(): TimerState {
  // localStorage에서 타이머 상태 복원 (초기값)
  const [timerLabel, setTimerLabel] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) ?? 'null');
      return saved?.endMs > Date.now() ? saved.label : null;
    } catch { return null; }
  });
  const [timerEndMs, setTimerEndMs] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) ?? 'null');
      return saved?.endMs > Date.now() ? saved.endMs : null;
    } catch { return null; }
  });
  const [timerDurationMs, setTimerDurationMs] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) ?? 'null');
      return saved?.endMs > Date.now() ? (saved.durationMs ?? 0) : 0;
    } catch { return 0; }
  });
  const [timerRemainMs, setTimerRemainMs] = useState<number>(0);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmLabel, setAlarmLabel] = useState<string | null>(null);

  const alarmFiredRef = useRef(false);
  const alarmDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // 이원화된 HTML5 Audio 객체 레퍼런스
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopBackgroundAudio = () => {
    if (silentAudioRef.current) {
      try {
        silentAudioRef.current.pause();
        silentAudioRef.current.src = "";
      } catch {}
      silentAudioRef.current = null;
    }
    if (alarmAudioRef.current) {
      try {
        alarmAudioRef.current.pause();
        alarmAudioRef.current.src = "";
      } catch {}
      alarmAudioRef.current = null;
    }
    // MediaSession 해제
    if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {}
    }
  };

  useEffect(() => {
    if (!timerEndMs) return;
    alarmFiredRef.current = false;

    const tick = () => {
      const remain = Math.max(0, timerEndMs - Date.now());
      setTimerRemainMs(remain);

      // MediaSession 남은 시간 실시간 업데이트
      if (remain > 0 && typeof window !== 'undefined' && 'mediaSession' in navigator && navigator.mediaSession.metadata) {
        try {
          navigator.mediaSession.metadata.artist = `남은 시간: ${formatTimerRemain(remain)}`;
          // setPositionState: 전체 타이머 시간 대비 경과 시간을 잠금화면 프로그레스바에 반영
          if (timerDurationMs > 0 && 'setPositionState' in navigator.mediaSession) {
            const totalSec = Math.ceil(timerDurationMs / 1000);
            const elapsedSec = Math.max(0, totalSec - Math.ceil(remain / 1000));
            (navigator.mediaSession as MediaSession & { setPositionState?: (s: object) => void }).setPositionState?.({
              duration: totalSec,
              playbackRate: 1,
              position: elapsedSec,
            });
          }
        } catch {}
      }

      if (remain === 0 && !alarmFiredRef.current) {
        alarmFiredRef.current = true;
        setTimerEndMs(null);
        clearTimerFromStorage();

        // 1. 무음 오디오 정지
        if (silentAudioRef.current) {
          try {
            silentAudioRef.current.pause();
          } catch {}
        }

        // 2. 미리 언락해 둔 실제 알람 오디오 재생 (src 변경 없이 즉각 play)
        if (alarmAudioRef.current) {
          try {
            alarmAudioRef.current.currentTime = 0;
            alarmAudioRef.current.play().catch((err) => {
              console.error("Alarm audio play failed on expiration:", err);
            });
          } catch (err) {
            console.error("Alarm audio play trigger error:", err);
          }
        }

        // 3. Web Audio API Chime 합성 (포그라운드 서포트)
        if (audioCtxRef.current) {
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') {
            ctx.resume().then(() => playAlarmChime(ctx)).catch(() => {});
          } else if (ctx.state === 'running') {
            playAlarmChime(ctx);
          }
        }

        setAlarmLabel(timerLabel);
        setAlarmVisible(true);

        // MediaSession 완료 표시
        if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: `[대기 완료] ${timerLabel || '타이머'}`,
              artist: '타이머가 완료되었습니다.',
              album: 'OnStep 타이머',
              artwork: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
              ]
            });
          } catch {}
        }

        // 4. Web Notification 발송 (서비스 워커 SHOW_NOTIFICATION 연동)
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          const title = '대기 완료';
          const options = {
            body: timerLabel || '타이머가 완료되었습니다.',
            tag: 'onstep-timer',
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 400],
            renotify: true,
          };
          try {
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.ready.then((registration) => {
                if (registration.active) {
                  registration.active.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    title,
                    options
                  });
                } else {
                  registration.showNotification(title, options);
                }
              }).catch(() => {
                new Notification(title, options);
              });
            } else {
              new Notification(title, options);
            }
          } catch (err) {
            console.error('Notification trigger error:', err);
          }
        }

        if (alarmDismissRef.current) clearTimeout(alarmDismissRef.current);
        alarmDismissRef.current = setTimeout(() => {
          setAlarmVisible(false);
          // 알람 대기 시간이 종료되면 사운드도 함께 멈춤
          if (alarmAudioRef.current) {
            try {
              alarmAudioRef.current.pause();
            } catch {}
          }
        }, 12000); // 알람 12초간 대기
      }
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [timerEndMs, timerLabel, timerDurationMs]);

  useEffect(() => () => {
    if (alarmDismissRef.current) clearTimeout(alarmDismissRef.current);
    stopBackgroundAudio();
  }, []);

  function startTimer(label: string, minutes: number) {
    setAlarmVisible(false);
    setTimerLabel(label);
    const durationMs = minutes * 60_000;
    const endMs = Date.now() + durationMs;
    setTimerDurationMs(durationMs);
    setTimerEndMs(endMs);
    saveTimerToStorage(label, endMs, durationMs);

    // 알림 권한 요청 (만약 아직 수락하지 않았다면)
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted') {
        Notification.requestPermission().then((permission) => {
          if (permission !== 'granted') {
            alert('타이머가 종료되었을 때 푸시 알림을 받으시려면 브라우저 알림 권한을 허용해주세요.');
          }
        }).catch((err) => {
          console.error('Notification permission request error:', err);
        });
      }
    }

    // 서비스 워커 백그라운드 타이머에 동기화
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          registration.active.postMessage({
            type: 'START_TIMER',
            label,
            endMs
          });
        }
      }).catch((err) => {
        console.error('Service worker message error:', err);
      });
    }

    // ── HTML5 Audio 백그라운드 세션 획득 및 알람 오디오 언락 ──
    try {
      stopBackgroundAudio();
      
      // A. 무음 루프 오디오 시작 (볼륨 0.05로 세션 유지)
      const silentAudio = new Audio(SILENT_WAV);
      silentAudio.loop = true;
      silentAudio.volume = 0.05;
      silentAudio.play().then(() => {
        silentAudioRef.current = silentAudio;
      }).catch((err) => {
        console.warn("Silent audio autoplay blocked, attempting to unlock:", err);
        silentAudioRef.current = silentAudio;
      });

      // B. 실제 알람 오디오 선제 언락 (볼륨 1.0, 무한반복 대기)
      const alarmAudio = new Audio(ALARM_SOUND_WAV);
      alarmAudio.loop = true;
      alarmAudio.volume = 1.0;
      alarmAudio.play().then(() => {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
        alarmAudioRef.current = alarmAudio;
      }).catch((err) => {
        console.warn("Alarm audio unlock failed:", err);
        alarmAudioRef.current = alarmAudio;
      });

      // Web Audio API Context 언락 (보조)
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtx();
        }
        if (audioCtxRef.current.state === 'suspended') {
          void audioCtxRef.current.resume();
        }
      }
    } catch (err) {
      console.error("Audio unlock trigger error:", err);
    }

    // Media Session API 설정 (잠금 화면 연동)
    if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `[진행중] ${label}`,
          artist: `남은 시간: ${minutes}분`,
          album: 'OnStep 타이머',
          artwork: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        });

        // 잠금 화면 재생기 컨트롤에 액션 등록
        // 사용자가 재생기에서 pause(일시정지) 또는 stop(정지)를 누르면 타이머 종료
        navigator.mediaSession.setActionHandler('pause', () => {
          stopTimer();
        });
        navigator.mediaSession.setActionHandler('stop', () => {
          stopTimer();
        });
        navigator.mediaSession.setActionHandler('play', () => {
          // iOS 우회용: play 클릭 시 계속해서 재생 상태 유지
        });
      } catch (e) {
        console.warn("MediaSession handler registration failed", e);
      }
    }
  }

  function stopTimer() {
    setTimerEndMs(null);
    setTimerLabel(null);
    setTimerRemainMs(0);
    setTimerDurationMs(0);
    setAlarmVisible(false);
    clearTimerFromStorage();
    stopBackgroundAudio();

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          registration.active.postMessage({
            type: 'STOP_TIMER'
          });
        }
      }).catch((err) => {
        console.error('Service worker stop message error:', err);
      });
    }
  }

  function dismissAlarm() {
    setAlarmVisible(false);
    stopBackgroundAudio();
  }

  return { timerLabel, timerEndMs, timerRemainMs, alarmVisible, alarmLabel, startTimer, stopTimer, dismissAlarm };
}
