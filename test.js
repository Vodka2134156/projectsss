const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
async function generatePnlImage(tokenName, multiple,color,image) {
    const baseImage = await loadImage(image);
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');
  
    ctx.drawImage(baseImage, 0, 0);
    ctx.fillStyle = color;
  
    ctx.font = 'bold 220px Comic Sans MS';
    let tokenText = `${tokenName}`;
    let tokenWidth = ctx.measureText(tokenText).width;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 12;
    ctx.strokeText(tokenText, canvas.width - tokenWidth - 30, 300, canvas.width - 60);
    ctx.fillText(tokenText, canvas.width - tokenWidth - 30, 300, canvas.width - 60);

    ctx.font = 'bold 200px Arial';
    let callbyText= `${multiple}%`;
    let callbtWidth = ctx.measureText(callbyText).width;
    ctx.strokeText(callbyText, canvas.width - callbtWidth - 50, 600, canvas.width - 60);
    ctx.fillText(callbyText, canvas.width - callbtWidth - 50, 600, canvas.width - 60);
  
    ctx.font = 'bold 200px Arial';
    let multipleText = `${multiple}%`;
    let multipleWidth = ctx.measureText(multipleText).width;
    ctx.strokeText(multipleText, canvas.width - multipleWidth - 50, 600, canvas.width - 60);
    ctx.fillText(multipleText, canvas.width - multipleWidth - 50, 600, canvas.width - 60);
   
  
    const buffer = canvas.toBuffer('image/png');
    const imagePath = `./pnl-${Date.now()}.png`;
    fs.writeFileSync(imagePath, buffer);
    return imagePath;
  }
  generatePnlImage("$trump",3,"./pnl","");