export const uploadMime: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const extensions = Object.keys(uploadMime).map((extension) => `.${extension}`);

export const attachmentPolicy = {
  accept: extensions.join(','),
  maxFiles: 5,
  maxSizeMb: 20,
};

export function validateAttachments(current: readonly File[], incoming: readonly File[]) {
  const valid: File[] = [];
  const errors: string[] = [];
  for (const file of incoming) {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!extensions.includes(extension)) errors.push(`«${file.name}»: неподдерживаемый формат.`);
    else if (file.size > attachmentPolicy.maxSizeMb * 1024 * 1024)
      errors.push(`«${file.name}»: файл больше ${attachmentPolicy.maxSizeMb} МБ.`);
    else if (file.size === 0) errors.push(`«${file.name}»: файл пуст.`);
    else valid.push(file);
  }
  if (current.length + valid.length > attachmentPolicy.maxFiles)
    errors.push(`За одно сообщение можно отправить до ${attachmentPolicy.maxFiles} файлов.`);
  return {
    files: [...current, ...valid].slice(0, attachmentPolicy.maxFiles),
    fileError: errors.join(' '),
  };
}
