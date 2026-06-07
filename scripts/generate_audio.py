import base64
import wave
import struct
import math
import io

def generate_silent_wav(duration=2.0, sample_rate=8000):
    num_samples = int(duration * sample_rate)
    # For 16-bit WAV, silence is 0
    data = struct.pack('<' + 'h' * num_samples, *([0] * num_samples))
    
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2) # 16-bit
        wav.setframerate(sample_rate)
        wav.writeframes(data)
    
    return base64.b64encode(out.getvalue()).decode('utf-8')

def generate_chime_wav(duration=2.0, sample_rate=8000):
    num_samples = int(duration * sample_rate)
    samples = []
    
    # 3-tone chime: A5 (880Hz), C6 (1046.5Hz), E6 (1318.5Hz)
    # 0.0s - 0.25s: A5
    # 0.25s - 0.5s: C6
    # 0.5s - 1.2s: E6
    # 1.2s - 2.0s: silence
    
    for i in range(num_samples):
        t = i / sample_rate
        val = 0.0
        
        if 0.0 <= t < 0.25:
            # Tone 1
            env = 1.0 - (t / 0.25)
            # Add a slight fade-in as well
            if t < 0.02:
                env *= (t / 0.02)
            val = math.sin(2 * math.pi * 880.0 * t) * env * 0.5
            
        elif 0.25 <= t < 0.5:
            # Tone 2
            t_rel = t - 0.25
            env = 1.0 - (t_rel / 0.25)
            if t_rel < 0.02:
                env *= (t_rel / 0.02)
            val = math.sin(2 * math.pi * 1046.50 * t_rel) * env * 0.5
            
        elif 0.5 <= t < 1.3:
            # Tone 3
            t_rel = t - 0.5
            env = 1.0 - (t_rel / 0.8)
            if t_rel < 0.02:
                env *= (t_rel / 0.02)
            val = math.sin(2 * math.pi * 1318.51 * t_rel) * env * 0.5
            
        else:
            val = 0.0
            
        # Convert to signed 16-bit integer (-32768 to 32767)
        sample_val = int(val * 32767)
        samples.append(max(-32768, min(32767, sample_val)))
        
    data = struct.pack('<' + 'h' * num_samples, *samples)
    
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2) # 16-bit
        wav.setframerate(sample_rate)
        wav.writeframes(data)
        
    return base64.b64encode(out.getvalue()).decode('utf-8')

silent_b64 = generate_silent_wav()
chime_b64 = generate_chime_wav()

with open('silent_wav.txt', 'w') as f:
    f.write(silent_b64)
with open('chime_wav.txt', 'w') as f:
    f.write(chime_b64)

print("Generated audio base64 text files successfully.")
