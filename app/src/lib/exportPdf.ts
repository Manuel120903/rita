/**
 * Hands a generated PDF to the OS share sheet.
 *
 * The PDF itself is built in JS (see pdf.ts), so the only thing that needs
 * native code is handing the bytes to Android/iOS. react-native-share accepts a
 * base64 data URL directly and writes the temporary file itself, which is why
 * there is no filesystem dependency here.
 *
 * The module is loaded lazily inside a try/catch on purpose: it is native code,
 * so it only exists after `pnpm install` plus a rebuild. Until then the rest of
 * the app keeps working and the screen shows a clear message instead of the
 * bundle failing to load.
 */

export type ExportOutcome =
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'module-missing' }
  | { status: 'error'; message: string };

interface ShareModule {
  open(options: Record<string, unknown>): Promise<{ success?: boolean }>;
}

function loadShare(): ShareModule | null {
  try {
    const mod = require('react-native-share');
    return (mod?.default ?? mod) as ShareModule;
  } catch {
    return null;
  }
}

export async function sharePdf(
  base64: string,
  fileName: string,
  subject: string,
): Promise<ExportOutcome> {
  const share = loadShare();
  if (!share) {
    return { status: 'module-missing' };
  }

  try {
    const result = await share.open({
      url: `data:application/pdf;base64,${base64}`,
      // react-native-share appends the extension from `type`.
      filename: fileName.replace(/\.pdf$/i, ''),
      type: 'application/pdf',
      subject,
      title: subject,
      failOnCancel: false,
      // Required on Android, not optional. The library writes the decoded file
      // into a cache directory and then hands it to a FileProvider, but its
      // provider (share_download_paths.xml) only declares two roots:
      // <external-path path="Download/"> and <cache-path path="/">, the latter
      // being the INTERNAL cache. With useInternalStorage false — the default —
      // it writes to getExternalCacheDir()/Download instead, which matches
      // neither root, so FileProvider.getUriForFile throws for every authority,
      // getURI() returns null, and ClipData.newUri then crashes with
      // "Uri.getScheme() on a null object reference". Internal cache is also the
      // right place for a temp file and, unlike getExternalCacheDir(), never
      // comes back null when external storage is unavailable.
      useInternalStorage: true,
    });
    return result?.success === false ? { status: 'cancelled' } : { status: 'shared' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Dismissing the sheet surfaces as an error on some Android versions.
    if (/cancel/i.test(message)) {
      return { status: 'cancelled' };
    }
    return { status: 'error', message };
  }
}
