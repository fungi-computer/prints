# Viewer video fixture

`viewer-testsrc.mp4` is a two-second, silent 320×180 H.264/yuv420p test pattern,
generated once with FFmpeg (not customer or generated-product media):

```sh
ffmpeg -y -f lavfi -i testsrc=size=320x180:rate=24 -t 2 \
  -c:v libx264 -threads 1 -pix_fmt yuv420p -movflags +faststart viewer-testsrc.mp4
```

`viewer-generation.mp4` is a five-second, silent 1280×720 H.264/yuv420p test
pattern for the default Seedance size and duration. Unlike the small
playback-only clip, its dimensions match the actual generation request and
Agar's result validation:

```sh
ffmpeg -n -f lavfi -i testsrc=size=1280x720:rate=12 -t 5 \
  -c:v libx264 -crf 28 -pix_fmt yuv420p -threads 1 -an \
  -movflags +faststart viewer-generation.mp4
```

Both fixtures are committed; tests do not install or invoke an encoder. The
generation fixture rejects other sizes, durations and audio-enabled requests
rather than reporting metadata that its bytes cannot supply.
