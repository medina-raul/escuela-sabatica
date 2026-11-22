import { useRef, useState, useEffect } from "react";
import type { AudioResource } from "@app-types/resource";

type Props = {
  audio?: AudioResource;
};

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ audio }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string>();
  const available = Boolean(audio?.url && failedUrl !== audio.url);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onDuration = () => setDuration(el.duration);
    const onEnd = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setFailedUrl(audio?.url);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDuration);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onError);
    if (el.error) onError();
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDuration);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onError);
    };
  }, [audio?.url]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      try {
        await el.play();
        setPlaying(true);
      } catch (error) {
        setPlaying(false);
        if (el.error || (error instanceof Error && error.name === "NotSupportedError")) setFailedUrl(audio?.url);
      }
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
    setCurrentTime(el.currentTime);
  };

  const skip = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.min(duration, Math.max(0, el.currentTime + delta));
    setCurrentTime(el.currentTime);
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const remaining = duration - currentTime;

  return (
    <div className="audio-player" id="audio">
      <div className="audio-row">
        <div className="audio-controls">
          <button className="audio-btn skip-btn" type="button" onClick={() => skip(-10)} aria-label="Retroceder 10s" title="−10s" disabled={!available}>
            ⏪
          </button>
          <button className="audio-btn play-btn" type="button" onClick={toggle} aria-label={playing ? "Pausar" : available ? "Reproducir" : "No disponible"} disabled={!available}>
            {playing ? "⏸" : "▶"}
          </button>
          <button className="audio-btn skip-btn" type="button" onClick={() => skip(10)} aria-label="Adelantar 10s" title="+10s" disabled={!available}>
            ⏩
          </button>
        </div>
        <div className="audio-body">
          <span className="audio-label" role="status">
            {available ? audio?.title || "Audio de la lección" : failedUrl ? "Audio temporalmente no disponible" : "Próximamente"}
          </span>
          <div className="audio-bar">
            <span className="audio-time-current">{audio?.url ? formatTime(currentTime) : "0:00"}</span>
            <div className="audio-progress-wrap">
              <div className="audio-progress-fill" style={{ width: `${audio?.url ? pct : 0}%` }}></div>
              <input
                className="audio-progress-input"
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={seek}
                aria-label="Progreso del audio"
                disabled={!available}
              />
            </div>
            <span className="audio-time-remaining">−{audio?.url ? formatTime(remaining) : "0:00"}</span>
          </div>
        </div>
      </div>
      {audio?.url && <audio ref={audioRef} src={audio.url} preload="none" />}
      {audio?.narrator && <span className="audio-credit">Audio gentileza de {audio.narrator}</span>}
    </div>
  );
}
