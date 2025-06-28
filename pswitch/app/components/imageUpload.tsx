import { ChangeEvent, useId } from "react";

export default function ImageUpload({ onUpload }: { onUpload: (uris: string[]) => void }) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if(event.target.files) {
      const uris: string[] = [];
      const uploadCount = event.target.files.length;
      for (const file of event.target.files) {
        const reader = new FileReader();
        reader.onload = function({ target }: ProgressEvent<FileReader>) {
          uris.push(target?.result as string);
          if (uris.length === uploadCount) { 
            onUpload(uris);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  }

  const id = useId();

  return (
    <div>
      <label htmlFor={id}>
        Upload images
      </label>
      <input
        id={id}
        type="file"
        multiple
        onChange={handleChange}
      />
    </div>
  );
}
