'use client';

import { useState, useRef } from "react";
import ImageUpload from "./imageUpload";
import stickerMatch from "../util/stickerMatch";

const start = [147, 79] as const;
const stickerDimensions = [170, 170] as const;
const stickerOffset = [208, 205] as const;
const pixelTotal = stickerDimensions[0] * stickerDimensions[1];
const threshold = 0.25;
const tolerance = 0.01;

const exclusions = [
  // Exclude top right "new sticker" indicator
  [stickerDimensions[0] - 50, 0, 50, 50],
  // Exclude cursor
  [0, stickerDimensions[1] - 30, 30, 30],
] as const;

export default function Comparer() {
  const [imageURIs, setImageURIs] = useState<readonly string[] | null>(null);
  const [canvases, setCanvases] = useState<readonly OffscreenCanvas[] | null>(null);
  
  const diffsRef = useRef<HTMLCanvasElement | null>(null);
  const sc1 = useRef<HTMLCanvasElement | null>(null);
  const sc2 = useRef<HTMLCanvasElement | null>(null);
  const sc3 = useRef<HTMLCanvasElement | null>(null);
  const sc4 = useRef<HTMLCanvasElement | null>(null);

  function loadCanvases() {
    if (imageURIs === null) {
      return null;
    }

    const loadedCanvases: OffscreenCanvas[] = [];

    for (const imageURI of imageURIs) {
      const canvas = new OffscreenCanvas(0, 0);
      const image = new Image();
      image.onload = () => {
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        loadedCanvases.push(canvas);
        if (loadedCanvases.length === imageURIs.length) {
          setCanvases(loadedCanvases);
        }
      };
      image.src = imageURI;
    }
  }

  function buildImageTags() {
    if (imageURIs === null) {
      return null;
    }

    return (
      <div>
        {
          imageURIs.map((imageURI, index) => {
            return (
              <img className="thumbnail" src={imageURI} key={index} height={100} width={100}></img>
            );
          })
        }
      </div>
    );
  }

  if (canvases === null) {
    loadCanvases();
  }

  function runDiff() {
    if (canvases === null) {
      return null;
    }

    const [canvas1, canvas2] = canvases;

    const imageDatas1 = getImageData(canvas1);
    const imageDatas2 = getImageData(canvas2);

    const diffCanvas = diffsRef.current!
    const diffContext = diffCanvas.getContext('2d')!
    
    // For now, recognize that they're in the same places for the comparisons

    let matchCount = 0;

    const sideCanvases = [sc1.current!, sc2.current!, sc3.current!, sc4.current!];

    for (let i = 0; i < imageDatas1.length; i++) {
      let diff = diffContext.createImageData(...stickerDimensions);
      const count = stickerMatch(
        imageDatas1[i].data,
        imageDatas2[i].data,
        diff.data,
        ...stickerDimensions,
        {
          threshold,
          exclusions,
        },
      );

      if (count / pixelTotal < tolerance) {
        matchCount += 1;
      } else {
        // Try scaling up the second one
        diff = diffContext.createImageData(...stickerDimensions);
        const scale = 1.2;
        const rescaledCanvas = sideCanvases.pop()!;
        const rescaledContext = rescaledCanvas.getContext('2d')!;
        if (rescaledContext.getTransform().a === 1) {
          rescaledContext.scale(scale, scale);
        }
        const extraCanvas = new OffscreenCanvas(...stickerDimensions);
        extraCanvas.getContext('2d')!.putImageData(imageDatas2[i], 0, 0);
        rescaledContext.drawImage(extraCanvas, 0, 0);
        const rescaledImageData = rescaledContext.getImageData(
          Math.floor(stickerDimensions[0] * (scale - 1)) / 2,
          Math.floor(stickerDimensions[1] * (scale - 1)) / 2,
          ...stickerDimensions
        );
        const originalCanvas = sideCanvases.pop()!;
        originalCanvas.getContext('2d')!.putImageData(
          imageDatas1[i],
          Math.floor(stickerDimensions[0] * (scale - 1)) / 2,
          Math.floor(stickerDimensions[1] * (scale - 1)) / 2,
        );
        console.log('trying again', i);
        const count = stickerMatch(
          imageDatas1[i].data,
          rescaledImageData.data,
          diff.data,
          ...stickerDimensions,
          {
            threshold,
            exclusions,
          },
        );
      }

      const destinationX = start[0] + Math.floor(i / 4) * stickerOffset[0];
      const destinationY = start[1] + (i % 4) * stickerOffset[1];

      diffContext.putImageData(diff, destinationX, destinationY);
    }

//    for (const imageData1 of imageDatas1) {
//      const withMatches = imageDatas2.filter((imageData2) => {
//        const count = pixelmatch(imageData1.data, imageData2.data, undefined, ...stickerDimensions, { threshold });
//        return count * 1.0 / pixelTotal < tolerance;
//      });

//      if (withMatches.length > 0) {
//        matchCount += 1;
//      }
//    }

    return matchCount;
  }

  function getImageData(stickerCanvas: OffscreenCanvas): readonly ImageData[] {
    const imageData: ImageData[] = [];
    const context = stickerCanvas.getContext('2d')!;

    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 4; y++) {
        const imageX = start[0] + stickerOffset[0] * x;
        const imageY = start[1] + stickerOffset[1] * y;

        imageData.push(context.getImageData(imageX, imageY, ...stickerDimensions));
      }
    }

    return imageData;
  }

  const matchCount = runDiff();

  return (
    <div>
      <ImageUpload onUpload={setImageURIs}/>
      {buildImageTags()}
      {matchCount}
      <canvas ref={diffsRef} width="1920" height="1080" />
      <canvas ref={sc1} width="2000" height="300" />
      <canvas ref={sc2} width="2000" height="300" />
      <canvas ref={sc3} width="2000" height="300" />
      <canvas ref={sc4} width="2000" height="300" />
    </div>
  )
}