// Pure-JS Inflate (from tiny-inflate by Devon Govett)
var TINF_OK = 0;
var TINF_DATA_ERROR = -3;

function Tree() {
  this.table = new Uint16Array(16);   /* table of code length counts */
  this.trans = new Uint16Array(288);  /* code -> symbol translation table */
}

function Data(source, dest) {
  this.source = source;
  this.sourceIndex = 0;
  this.tag = 0;
  this.bitcount = 0;
  this.dest = dest;
  this.destLen = 0;
  this.ltree = new Tree();  /* dynamic length/symbol tree */
  this.dtree = new Tree();  /* dynamic distance tree */
}

var sltree = new Tree();
var sdtree = new Tree();
var length_bits = new Uint8Array(30);
var length_base = new Uint16Array(30);
var dist_bits = new Uint8Array(30);
var dist_base = new Uint16Array(30);
var clcidx = new Uint8Array([
  16, 17, 18, 0, 8, 7, 9, 6,
  10, 5, 11, 4, 12, 3, 13, 2,
  14, 1, 15
]);
var code_tree = new Tree();
var lengths = new Uint8Array(288 + 32);

function tinf_build_bits_base(bits, base, delta, first) {
  var i, sum;
  for (i = 0; i < delta; ++i) bits[i] = 0;
  for (i = 0; i < 30 - delta; ++i) bits[i + delta] = i / delta | 0;
  for (sum = first, i = 0; i < 30; ++i) {
    base[i] = sum;
    sum += 1 << bits[i];
  }
}

function tinf_build_fixed_trees(lt, dt) {
  var i;
  for (i = 0; i < 7; ++i) lt.table[i] = 0;
  lt.table[7] = 24;
  lt.table[8] = 152;
  lt.table[9] = 112;
  for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
  for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
  for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
  for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;
  for (i = 0; i < 5; ++i) dt.table[i] = 0;
  dt.table[5] = 32;
  for (i = 0; i < 32; ++i) dt.trans[i] = i;
}

var offs = new Uint16Array(16);
function tinf_build_tree(t, lengths, off, num) {
  var i, sum;
  for (i = 0; i < 16; ++i) t.table[i] = 0;
  for (i = 0; i < num; ++i) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (sum = 0, i = 0; i < 16; ++i) {
    offs[i] = sum;
    sum += t.table[i];
  }
  for (i = 0; i < num; ++i) {
    if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
  }
}

function tinf_getbit(d) {
  if (!d.bitcount--) {
    d.tag = d.source[d.sourceIndex++];
    d.bitcount = 7;
  }
  var bit = d.tag & 1;
  d.tag >>>= 1;
  return bit;
}

function tinf_read_bits(d, num, base) {
  if (!num) return base;
  while (d.bitcount < 24) {
    d.tag |= d.source[d.sourceIndex++] << d.bitcount;
    d.bitcount += 8;
  }
  var val = d.tag & (0xffff >>> (16 - num));
  d.tag >>>= num;
  d.bitcount -= num;
  return val + base;
}

function tinf_decode_symbol(d, t) {
  while (d.bitcount < 24) {
    d.tag |= d.source[d.sourceIndex++] << d.bitcount;
    d.bitcount += 8;
  }
  var sum = 0, cur = 0, len = 0;
  var tag = d.tag;
  do {
    cur = 2 * cur + (tag & 1);
    tag >>>= 1;
    ++len;
    sum += t.table[len];
    cur -= t.table[len];
  } while (cur >= 0);
  d.tag = tag;
  d.bitcount -= len;
  return t.trans[sum + cur];
}

function tinf_decode_trees(d, lt, dt) {
  var hlit, hdist, hclen;
  var i, num, length;
  hlit = tinf_read_bits(d, 5, 257);
  hdist = tinf_read_bits(d, 5, 1);
  hclen = tinf_read_bits(d, 4, 4);
  for (i = 0; i < 19; ++i) lengths[i] = 0;
  for (i = 0; i < hclen; ++i) {
    var clen = tinf_read_bits(d, 3, 0);
    lengths[clcidx[i]] = clen;
  }
  tinf_build_tree(code_tree, lengths, 0, 19);
  for (num = 0; num < hlit + hdist;) {
    var sym = tinf_decode_symbol(d, code_tree);
    switch (sym) {
      case 16:
        var prev = lengths[num - 1];
        for (length = tinf_read_bits(d, 2, 3); length; --length) {
          lengths[num++] = prev;
        }
        break;
      case 17:
        for (length = tinf_read_bits(d, 3, 3); length; --length) {
          lengths[num++] = 0;
        }
        break;
      case 18:
        for (length = tinf_read_bits(d, 7, 11); length; --length) {
          lengths[num++] = 0;
        }
        break;
      default:
        lengths[num++] = sym;
        break;
    }
  }
  tinf_build_tree(lt, lengths, 0, hlit);
  tinf_build_tree(dt, lengths, hlit, hdist);
}

function tinf_inflate_block_data(d, lt, dt) {
  while (1) {
    var sym = tinf_decode_symbol(d, lt);
    if (sym === 256) return TINF_OK;
    if (sym < 256) {
      d.dest[d.destLen++] = sym;
    } else {
      var length, dist, offs;
      var i;
      sym -= 257;
      length = tinf_read_bits(d, length_bits[sym], length_base[sym]);
      dist = tinf_decode_symbol(d, dt);
      offs = d.destLen - tinf_read_bits(d, dist_bits[dist], dist_base[dist]);
      for (i = offs; i < offs + length; ++i) {
        d.dest[d.destLen++] = d.dest[i];
      }
    }
  }
}

function tinf_inflate_uncompressed_block(d) {
  var length, invlength;
  var i;
  while (d.bitcount > 8) {
    d.sourceIndex--;
    d.bitcount -= 8;
  }
  length = d.source[d.sourceIndex + 1];
  length = 256 * length + d.source[d.sourceIndex];
  invlength = d.source[d.sourceIndex + 3];
  invlength = 256 * invlength + d.source[d.sourceIndex + 2];
  if (length !== (~invlength & 0x0000ffff)) return TINF_DATA_ERROR;
  d.sourceIndex += 4;
  for (i = length; i; --i) d.dest[d.destLen++] = d.source[d.sourceIndex++];
  d.bitcount = 0;
  return TINF_OK;
}

function tinf_uncompress(source, dest) {
  var d = new Data(source, dest);
  var bfinal, btype, res;
  do {
    bfinal = tinf_getbit(d);
    btype = tinf_read_bits(d, 2, 0);
    switch (btype) {
      case 0:
        res = tinf_inflate_uncompressed_block(d);
        break;
      case 1:
        res = tinf_inflate_block_data(d, sltree, sdtree);
        break;
      case 2:
        tinf_decode_trees(d, d.ltree, d.dtree);
        res = tinf_inflate_block_data(d, d.ltree, d.dtree);
        break;
      default:
        res = TINF_DATA_ERROR;
    }
    if (res !== TINF_OK) throw new Error('Zlib Decompression error');
  } while (!bfinal);
  
  if (d.destLen < d.dest.length) {
    return d.dest.subarray(0, d.destLen);
  }
  return d.dest;
}

tinf_build_fixed_trees(sltree, sdtree);
tinf_build_bits_base(length_bits, length_base, 4, 3);
tinf_build_bits_base(dist_bits, dist_base, 2, 1);
length_bits[28] = 0;
length_base[28] = 258;


// -- PNG Parser Implementation --

function readInt32(arr, offset) {
  return ((arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3]) >>> 0;
}

function paethPredictor(a, b, c) {
  var p = a + b - c;
  var pa = Math.abs(p - a);
  var pb = Math.abs(p - b);
  var pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  else if (pb <= pc) return b;
  return c;
}

function decodePNG(pngBytes) {
  // Check PNG signature
  var signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (var i = 0; i < 8; i++) {
    if (pngBytes[i] !== signature[i]) {
      throw new Error('Invalid PNG signature');
    }
  }

  var idx = 8;
  var width = 0;
  var height = 0;
  var colorType = 0;
  var bitDepth = 0;
  var palette = null;
  
  // Collect IDAT buffers
  var idatBuffers = [];
  var totalIdatLength = 0;

  while (idx < pngBytes.length) {
    var length = readInt32(pngBytes, idx);
    var typeBytes = pngBytes.subarray(idx + 4, idx + 8);
    var type = String.fromCharCode(typeBytes[0], typeBytes[1], typeBytes[2], typeBytes[3]);
    var data = pngBytes.subarray(idx + 8, idx + 8 + length);
    
    idx += 12 + length; // Length (4) + Type (4) + Data (length) + CRC (4)

    if (type === 'IHDR') {
      width = readInt32(data, 0);
      height = readInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      var compression = data[10];
      var filter = data[11];
      var interlace = data[12];

      if (compression !== 0 || filter !== 0) {
        throw new Error('Unsupported PNG compression or filter method');
      }
      if (interlace !== 0) {
        throw new Error('Interlaced PNGs are not supported');
      }
      if (bitDepth !== 8) {
        throw new Error('Only 8-bit depth PNGs are supported');
      }
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idatBuffers.push(data);
      totalIdatLength += length;
    } else if (type === 'IEND') {
      break;
    }
  }

  // Concatenate IDAT data
  var idatData = new Uint8Array(totalIdatLength);
  var offset = 0;
  for (var k = 0; k < idatBuffers.length; k++) {
    idatData.set(idatBuffers[k], offset);
    offset += idatBuffers[k].length;
  }

  // Determine BPP (bytes per pixel)
  var bpp = 1;
  if (colorType === 2) bpp = 3;      // RGB
  else if (colorType === 6) bpp = 4; // RGBA
  else if (colorType === 3) bpp = 1; // Indexed
  else {
    throw new Error('Unsupported color type: ' + colorType);
  }

  // Inflate IDAT data (strip zlib wrapper: 2 bytes header at beginning, 4 bytes checksum at end)
  var rawDeflateData = idatData.subarray(2, idatData.length - 4);
  var rowBytes = width * bpp;
  var decompressedSize = height * (1 + rowBytes);
  var decompressed = new Uint8Array(decompressedSize);
  
  tinf_uncompress(rawDeflateData, decompressed);

  // Apply inverse filters
  var scanlineBytes = 1 + rowBytes;
  var pixels = new Uint8Array(width * height * 4); // RGBA output

  for (var y = 0; y < height; y++) {
    var rowStart = y * scanlineBytes;
    var filterType = decompressed[rowStart];
    var rowData = decompressed.subarray(rowStart + 1, rowStart + 1 + rowBytes);
    
    // Buffer for reconstructed row
    var reconRow = new Uint8Array(rowBytes);
    
    for (var x = 0; x < rowBytes; x++) {
      var rawVal = rowData[x];
      var left = (x >= bpp) ? reconRow[x - bpp] : 0;
      var up = (y > 0) ? decompressed[(y - 1) * scanlineBytes + 1 + x] : 0;
      var upleft = (y > 0 && x >= bpp) ? decompressed[(y - 1) * scanlineBytes + 1 + x - bpp] : 0;
      
      var reconVal = 0;
      switch (filterType) {
        case 0: // None
          reconVal = rawVal;
          break;
        case 1: // Sub
          reconVal = (rawVal + left) & 255;
          break;
        case 2: // Up
          reconVal = (rawVal + up) & 255;
          break;
        case 3: // Average
          reconVal = (rawVal + Math.floor((left + up) / 2)) & 255;
          break;
        case 4: // Paeth
          reconVal = (rawVal + paethPredictor(left, up, upleft)) & 255;
          break;
        default:
          throw new Error('Unknown filter type: ' + filterType);
      }
      reconRow[x] = reconVal;
      
      // Update decompressed data in-place so subsequent rows can use it as 'up' and 'upleft' reference
      decompressed[rowStart + 1 + x] = reconVal;
    }

    // Convert reconstructed row to RGBA output
    for (var px = 0; px < width; px++) {
      var outIdx = (y * width + px) * 4;
      if (colorType === 2) { // RGB
        pixels[outIdx]     = reconRow[px * 3];
        pixels[outIdx + 1] = reconRow[px * 3 + 1];
        pixels[outIdx + 2] = reconRow[px * 3 + 2];
        pixels[outIdx + 3] = 255; // Opaque
      } else if (colorType === 6) { // RGBA
        pixels[outIdx]     = reconRow[px * 4];
        pixels[outIdx + 1] = reconRow[px * 4 + 1];
        pixels[outIdx + 2] = reconRow[px * 4 + 2];
        pixels[outIdx + 3] = reconRow[px * 4 + 3];
      } else if (colorType === 3) { // Indexed
        var paletteIdx = reconRow[px];
        if (palette) {
          pixels[outIdx]     = palette[paletteIdx * 3];
          pixels[outIdx + 1] = palette[paletteIdx * 3 + 1];
          pixels[outIdx + 2] = palette[paletteIdx * 3 + 2];
          pixels[outIdx + 3] = 255; // Opaque
        } else {
          pixels[outIdx]     = paletteIdx;
          pixels[outIdx + 1] = paletteIdx;
          pixels[outIdx + 2] = paletteIdx;
          pixels[outIdx + 3] = 255;
        }
      }
    }
  }

  return {
    width: width,
    height: height,
    pixels: pixels
  };
}

module.exports = {
  decodePNG: decodePNG
};
