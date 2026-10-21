# Bounded PNG reader for legacy icon identification. OS awk + gzip only.
# mode=extract: decimal PNG bytes -> synthetic gzip stream; meta stores IHDR/palette/Adler.
# mode=samples: decimal deflated scanline bytes -> 64x64 premultiplied RGBA box averages.
function xorbyte(a,b) { return nx[a%16,b%16]+16*nx[int(a/16),int(b/16)] }
function xor32(a,b, out,scale,k) {
  scale=1;out=0
  for(k=0;k<4;k++){out+=scale*xorbyte(a%256,b%256);a=int(a/256);b=int(b/256);scale*=256}
  return out
}
function crcb(v,c) { return xor32(int(c/256),ct[xorbyte(c%256,v)]) }
function initcrc( a,b,x,y,n,k,t) {
  for(a=0;a<16;a++)for(b=0;b<16;b++) {
    x=a;y=b;n=0;t=1
    for(k=0;k<4;k++){if(x%2!=y%2)n+=t;x=int(x/2);y=int(y/2);t*=2}
    nx[a,b]=n
  }
  for(a=0;a<256;a++){x=a;for(k=0;k<8;k++)x=x%2?xor32(int(x/2),3988292384):int(x/2);ct[a]=x}
}
function fail() { bad=1; exit 2 }
function emit(v) { printf "%c",v }
function idat(v, j) {
  if (compressed++ < 2) { zhead[compressed]=v; return }
  tail[++tails]=v
  if(tails>4) { emit(tail[tails-4]); delete tail[tails-4] }
}
function closechunk( i,k) {
  if(kind=="IHDR") {
    if(chunklen!=13 || header++) fail()
    w=payload[0]*16777216+payload[1]*65536+payload[2]*256+payload[3]
    h=payload[4]*16777216+payload[5]*65536+payload[6]*256+payload[7]
    depth=payload[8]; colour=payload[9]
    if(w<64 || h<64 || w>2048 || h>2048 || depth!=8 || (colour!=2 && colour!=3 && colour!=6) || payload[10] || payload[11] || payload[12]) fail()
    print "header",w,h,colour > meta
  } else if(kind=="PLTE") {
    if(!chunklen || chunklen>768 || chunklen%3 || palette++ || seenidat) fail()
    paletteEntries=chunklen/3
    for(i=0;i<chunklen;i+=3) print "palette",i/3,payload[i],payload[i+1],payload[i+2] > meta
  } else if(kind=="tRNS") {
    if(colour!=3 || !palette || !chunklen || chunklen>paletteEntries || transparency++ || seenidat) fail()
    for(i=0;i<chunklen;i++) print "alpha",i,payload[i] > meta
  } else if(kind=="IEND") { if(chunklen || !seenidat) fail(); ended=1 }
  delete payload
}
function extract(v) {
  if(offset<8) {
    if(v!=signature[offset+1]) fail()
    offset++; return
  }
  if(ended) fail()
  if(state=="length") {
    chunklen=chunklen*256+v
    if(++count==4) { if(chunklen>16777216) fail(); state="kind";count=0;kind="";crc=4294967295;givencrc=0 }
  } else if(state=="kind") {
    if(!((v>=65 && v<=90) || (v>=97 && v<=122)) || (count==2 && v>90))fail()
    crc=crcb(v,crc);kind=kind sprintf("%c",v)
    if(++count==4) { state=(chunklen?"data":"crc");count=0
      if(!header && kind!="IHDR")fail()
      if(substr(kind,1,1) ~ /^[A-Z]$/ && kind!="IHDR" && kind!="PLTE" && kind!="IDAT" && kind!="IEND")fail()
      if(kind=="IDAT") { if(!header || idatended || (colour==3 && !palette))fail();seenidat=1 }
      else if(seenidat)idatended=1 }
  } else if(state=="data") {
    crc=crcb(v,crc)
    if(kind=="IDAT") idat(v)
    else if(kind=="IHDR" || kind=="PLTE" || kind=="tRNS") {
      if(count>768) fail()
      payload[count]=v
    }
    if(++count==chunklen) { state="crc"; count=0 }
  } else if(state=="crc") {
    givencrc=givencrc*256+v
    if(++count==4) { if(givencrc!=4294967295-crc)fail();closechunk();state="length";count=0;chunklen=0 }
  } else fail()
}
function paeth(a,b,c, p,da,db,dc) {
  p=a+b-c; da=p-a;if(da<0)da=-da;db=p-b;if(db<0)db=-db;dc=p-c;if(dc<0)dc=-dc
  return da<=db && da<=dc?a:(db<=dc?b:c)
}
function sample(v, left,up,corner,k,r,g,b,a,bucket) {
  # Adler checks the original decompressed bytes, before filter reversal.
  ad1=(ad1+v)%65521;ad2=(ad2+ad1)%65521
  if(++decoded>expected) fail()
  if(column==-1) { filter=v; if(filter>4)fail();column=0;return }
  left=column>=channels?current[column-channels]:0
  up=previous[column]+0;corner=column>=channels?previous[column-channels]+0:0
  if(filter==1)v+=left
  else if(filter==2)v+=up
  else if(filter==3)v+=int((left+up)/2)
  else if(filter==4)v+=paeth(left,up,corner)
  v%=256;current[column]=v
  if(column%channels==channels-1) {
    k=column-channels+1
    if(colour==3) {
      k=current[k];if(!(k in red))fail();r=red[k];g=green[k];b=blue[k];a=(k in alpha)?alpha[k]:255
    } else { r=current[k];g=current[k+1];b=current[k+2];a=colour==6?current[k+3]:255 }
    bucket=int(row*64/h)*64+int(int(column/channels)*64/w)
    sr[bucket]+=r*a/255;sg[bucket]+=g*a/255;sb[bucket]+=b*a/255;sa[bucket]+=a;counts[bucket]++
  }
  if(++column==w*channels) {
    for(k=0;k<column;k++)previous[k]=current[k]
    column=-1;row++
  }
}
BEGIN {
  if(mode=="extract") {
    initcrc()
    split("137 80 78 71 13 10 26 10",signature," ");state="length"
    emit(31);emit(139);emit(8); for(i=0;i<7;i++)emit(0)
  } else if(mode=="samples") {
    while((getline line < meta)>0) {
      split(line,m," ")
      if(m[1]=="header") { w=m[2]+0;h=m[3]+0;colour=m[4]+0 }
      else if(m[1]=="palette") { red[m[2]]=m[3]+0;green[m[2]]=m[4]+0;blue[m[2]]=m[5]+0 }
      else if(m[1]=="alpha")alpha[m[2]]=m[3]+0
      else if(m[1]=="adler") { checksum=m[2]+0;haschecksum=1 }
      else fail()
    }
    if(w<64 || h<64 || w>2048 || h>2048 || (colour!=2 && colour!=3 && colour!=6) || !haschecksum)fail()
    channels=colour==6?4:(colour==2?3:1);expected=(w*channels+1)*h
    ad1=1;column=-1
  } else fail()
}
{
  for(i=1;i<=NF;i++) {
    if($i!~/^[0-9]+$/ || $i>255)fail()
    if(mode=="extract")extract($i+0);else sample($i+0)
  }
}
END {
  if(bad)exit 2
  if(mode=="extract") {
    if(!ended || !header || tails<4 || compressed<6 || zhead[1]%16!=8 || int(zhead[1]/16)>7 || (zhead[1]*256+zhead[2])%31 || int(zhead[2]/32)%2)exit 2
    printf "adler %.0f\n",tail[tails-3]*16777216+tail[tails-2]*65536+tail[tails-1]*256+tail[tails] > meta
    for(i=0;i<8;i++)emit(0)
  } else {
    if(decoded!=expected || row!=h || column!=-1 || ad2*65536+ad1!=checksum)exit 2
    for(i=0;i<4096;i++) { if(!counts[i])exit 2;printf "%.6f %.6f %.6f %.6f\n",sr[i]/counts[i],sg[i]/counts[i],sb[i]/counts[i],sa[i]/counts[i] }
  }
}
