'use client';

import { useRef, useState } from 'react';
import { Group, ActionIcon, Slider, Text } from '@mantine/core';

interface AudioPlayerProps {
  filename: string;
  onPlay?: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ filename, onPlay }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [notified, setNotified] = useState(false);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
      if (!notified) {
        onPlay?.();
        setNotified(true);
      }
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setProgress(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleEnded = () => setPlaying(false);

  const seek = (value: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = value;
    setProgress(value);
  };

  return (
    <Group gap="sm" align="center">
      <audio
        ref={audioRef}
        src={`/api/audio/${encodeURIComponent(filename)}`}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
      />
      <ActionIcon variant="filled" onClick={toggle} size="lg">
        {playing ? '⏸' : '▶'}
      </ActionIcon>
      <Slider
        value={progress}
        max={duration || 1}
        onChange={seek}
        style={{ flex: 1 }}
        size="sm"
        label={null}
      />
      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        {formatTime(progress)} / {formatTime(duration)}
      </Text>
    </Group>
  );
}
