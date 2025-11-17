import fs from "node:fs";

export function setupLogWriter(logFile?: string): () => void {

  if (!logFile) {
    return () => {};
  }

  const stream = fs.createWriteStream(logFile, { flags: "a" });

  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);

  const write = (
    original: typeof process.stdout.write,
    chunk: string | Buffer,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    const data = typeof chunk === "string" ? Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8") : chunk;
    stream.write(data);
    return original(chunk as never, encoding as never, callback as never);
  };

  const patchedStdout = function (
    chunk: string | Buffer,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) {
    return write(originalStdout, chunk, encoding, callback);
  };

  const patchedStderr = function (
    chunk: string | Buffer,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) {
    return write(originalStderr, chunk, encoding, callback);
  };

  process.stdout.write = patchedStdout as typeof process.stdout.write;
  process.stderr.write = patchedStderr as typeof process.stderr.write;

  return () => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    stream.end();
  };
}
