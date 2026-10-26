import PDFParser from 'pdf2json';

export function extractTextFromPDF(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);

    pdfParser.on('pdfParser_dataError', errData => {
      reject(new Error(errData.parserError));
    });

    pdfParser.on('pdfParser_dataReady', pdfData => {
      try {
        const parsedText = pdfParser.getRawTextContent();
        console.log(`📄 Successfully extracted ${parsedText.length} characters from PDF via pdf2json.`);
        resolve(parsedText);
      } catch (err) {
        reject(err);
      }
    });

    const parserBuffer = Buffer.allocUnsafeSlow(buffer.byteLength);
    Buffer.from(buffer).copy(parserBuffer);
    pdfParser.parseBuffer(parserBuffer);
  });
}