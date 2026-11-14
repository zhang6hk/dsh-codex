const [, , ...args] = process.argv

if (args.includes('--fail')) {
  process.stderr.write('boom: engine rejected the request\n')
  process.exit(2)
}

if (args.includes('--sleep')) {
  setTimeout(() => process.exit(0), 5000)
} else {
  process.stdout.write(
    JSON.stringify({
      args,
      cwd: process.cwd(),
      dataDir: process.env.CLAUDE_PLUGIN_DATA ?? null,
    }),
  )
  process.exit(0)
}
