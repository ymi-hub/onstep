import base64
import wave
import math
import io

def generate_silent_wav(duration=1.0, sample_rate=8000):
    num_samples = int(duration * sample_rate)
    # For 8-bit WAV, silence is 128 (0x80)
    data = bytes([128] * num_samples)
    
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(1) # 8-bit
        wav.setframerate(sample_rate)
        wav.writeframes(data)
    
    return base64.b64encode(out.getvalue()).decode('utf-8')

def generate_chime_wav(duration=1.0, sample_rate=8000):
    num_samples = int(duration * sample_rate)
    samples = bytearray(num_samples)
    
    # 3-tone chime: A5 (880Hz), C6 (1046Hz), E6 (1318Hz)
    # 0.0s - 0.2s: A5
    # 0.2s - 0.4s: C6
    # 0.4s - 0.8s: E6
    # 0.8s - 1.0s: silence
    
    for i in range(num_samples):
        t = i / sample_rate
        val = 0.0
        
        if 0.0 <= t < 0.2:
            env = 1.0 - (t / 0.2)
            val = math.sin(2 * math.pi * 880.0 * t) * env * 0.5
        elif 0.2 <= t < 0.4:
            t_rel = t - 0.2
            env = 1.0 - (t_rel / 0.2)
            val = math.sin(2 * math.pi * 1046.50 * t_rel) * env * 0.5
        elif 0.4 <= t < 0.8:
            t_rel = t - 0.4
            env = 1.0 - (t_rel / 0.4)
            val = math.sin(2 * math.pi * 1318.51 * t_rel) * env * 0.5
        else:
            val = 0.0
            
        sample_val = int(128 + val * 127)
        samples[i] = max(0, min(255, sample_val))
        
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(1) # 8-bit
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(samples))
        
    return base64.b64encode(out.getvalue()).decode('utf-8')

silent_b64 = generate_silent_wav()
chime_b64 = generate_chime_wav()

with open('silent_wav_small.txt', 'w') as f:
    f.write(silent_b64)
with open('chime_wav_small.txt', 'w') as f:
    f.write(chime_b64)

print("Generated small audio base64 files successfully.")
