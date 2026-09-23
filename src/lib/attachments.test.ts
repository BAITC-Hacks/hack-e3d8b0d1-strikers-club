import { describe, expect, it } from 'vitest';
import { attachmentPolicy, validateAttachments } from './attachments';

describe('attachment policy', () => {
  it('accepts every advertised extension, including uppercase names', () => {
    const files = attachmentPolicy.accept
      .split(',')
      .map((ext) => new File(['data'], `file${ext.toUpperCase()}`));
    for (const file of files)
      expect(validateAttachments([], [file])).toEqual({ files: [file], fileError: '' });
  });

  it('rejects legacy office formats and accepts a file at the 20 MB limit', () => {
    const legacy = [new File(['data'], 'file.doc'), new File(['data'], 'file.xls')];
    expect(validateAttachments([], legacy).files).toEqual([]);
    const file = new File([new Uint8Array(20 * 1024 * 1024)], 'large.pdf');
    expect(validateAttachments([], [file])).toEqual({ files: [file], fileError: '' });
  });

  it('rejects unsupported, empty and oversized files while preserving valid selections', () => {
    const existing = new File(['existing'], 'existing.pdf');
    const valid = new File(['data'], 'valid.jpg');
    const huge = new File(
      [new Uint8Array(attachmentPolicy.maxSizeMb * 1024 * 1024 + 1)],
      'huge.pdf',
    );
    const result = validateAttachments(
      [existing],
      [new File(['data'], 'file.exe'), new File([], 'empty.pdf'), huge, valid],
    );
    expect(result.files).toEqual([existing, valid]);
    expect(result.fileError).toContain('неподдерживаемый формат');
    expect(result.fileError).toContain('файл пуст');
    expect(result.fileError).toContain(`больше ${attachmentPolicy.maxSizeMb} МБ`);
  });

  it('limits the combined selection without dropping already attached files', () => {
    const files = Array.from(
      { length: attachmentPolicy.maxFiles + 1 },
      (_, index) => new File(['data'], `${index}.pdf`),
    );
    const result = validateAttachments(files.slice(0, 2), files.slice(2));
    expect(result.files).toEqual(files.slice(0, attachmentPolicy.maxFiles));
    expect(result.fileError).toContain(`до ${attachmentPolicy.maxFiles} файлов`);
  });
});
