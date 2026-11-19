// REYZ — Contour. A new parametric sculpture, drawn without input media.
// Build from the repository root:
//   c++ -std=c++17 -O3 tools/render_brand_contour.cpp -o /tmp/reyz-contour
//   /tmp/reyz-contour | ffmpeg -f rawvideo -pixel_format rgb24 -video_size 1280x720 -framerate 24 -i - -an -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart site/assets/brand/brand-contour-v1.mp4
//   ffmpeg -i site/assets/brand/brand-contour-v1.mp4 -frames:v 1 -c:v libwebp -quality 90 site/assets/brand/brand-contour-v1.webp
// Pass a frame index to emit a single RGB frame (0–119). Frame 120 repeats frame 0.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

namespace {
constexpr int width=1280, height=720, sampling=2;
constexpr int rasterWidth=width*sampling, rasterHeight=height*sampling;
constexpr int frames=120, sections=480, bevelSteps=20, strips=7;
constexpr double tau=6.2831853071795864769;

struct Vec {
    double x, y, z;
    Vec operator+(const Vec& v) const { return {x+v.x, y+v.y, z+v.z}; }
    Vec operator-(const Vec& v) const { return {x-v.x, y-v.y, z-v.z}; }
    Vec operator*(double s) const { return {x*s, y*s, z*s}; }
};
double dot(const Vec& a,const Vec& b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
Vec unit(const Vec& a) { return a*(1.0/std::sqrt(dot(a,a))); }
Vec cross(const Vec& a,const Vec& b) { return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x}; }
struct View {
    double yaw, tilt, roll;
    Vec transform(Vec a) const {
        const double x=a.x*std::cos(yaw)+a.z*std::sin(yaw);
        const double z=-a.x*std::sin(yaw)+a.z*std::cos(yaw);
        const double y=a.y*std::cos(tilt)-z*std::sin(tilt);
        return {x*std::cos(roll)-y*std::sin(roll), x*std::sin(roll)+y*std::cos(roll), a.y*std::sin(tilt)+z*std::cos(tilt)};
    }
};
struct Vertex { double x, y, z; Vec rgb; };

double lobe(const Vec& direction,const Vec& light,double power) {
    return std::pow(std::max(0.0,dot(direction,light)),power);
}

struct Surface {
    Vec softbox, rim;
    Vec color(Vec n, double path, double band, double z) const {
        n=unit(n);
        const Vec reflection=n*(2*n.z)-Vec{0,0,1};
        // Anodized magenta lamellae, with a long reflected strip and a small white kick.
        const double pigment=0.87+0.13*std::cos(path-band*.2);
        const double facing=std::max(0.0,n.z);
        const double diffuse=.17+.31*std::max(0.0,dot(n,softbox))+.16*std::max(0.0,n.y);
        const double broad=lobe(reflection,softbox,4.0), spec=lobe(reflection,softbox,38.0);
        const double rimLight=lobe(reflection,rim,9.0);
        const double strip=std::exp(-std::pow((reflection.x+.45*reflection.y-.25)/.115,2))*(.35+.65*std::max(0.0,reflection.y));
        const double edge=std::pow(1.0-facing,3.0);
        const double depth=.78+.21*std::clamp(z,-1.0,1.0);
        const double card=std::exp(-std::pow((reflection.y-.28*reflection.x-.38)/.22,2))*(.35+.65*facing);
        const double key=(.33+.67*std::pow(.5+.5*std::cos(path-.18),2))*(.55+.45*std::cos(path*2+.6));
        const double polish=.7+.3*std::cos(band*.7);
        return (Vec{.85,.0085,.30}*((diffuse+.56*broad)*pigment)
            +Vec{.70,.48,.59}*(1.20*spec+.32*strip+.94*card*key*polish)
            +Vec{.52,.035,.28}*(.36*rimLight+.08*edge))*depth;
    }
};
std::vector<float> depthBuffer(rasterWidth*rasterHeight);
std::vector<unsigned char> samples(rasterWidth*rasterHeight*3), output(width*height*3);
std::array<unsigned char,4096> transfer;

void triangle(const Vertex& a,const Vertex& b,const Vertex& c) {
    const double bx=b.x-a.x, by=b.y-a.y, cx=c.x-a.x, cy=c.y-a.y;
    const double area=bx*cy-by*cx;
    if(std::abs(area)<1e-7) return;
    const int x0=std::max(0,(int)std::floor(std::min({a.x,b.x,c.x}))), x1=std::min(rasterWidth-1,(int)std::ceil(std::max({a.x,b.x,c.x})));
    const int y0=std::max(0,(int)std::floor(std::min({a.y,b.y,c.y}))), y1=std::min(rasterHeight-1,(int)std::ceil(std::max({a.y,b.y,c.y})));
    const double inv=1/area;
    for(int y=y0;y<=y1;++y) {
        for(int x=x0;x<=x1;++x) {
            const double dx=x+.5-a.x, dy=y+.5-a.y;
            const double u=(dx*cy-dy*cx)*inv, v=(bx*dy-by*dx)*inv;
            if(u<0 || v<0 || u+v>1) continue;
            const double w=1-u-v, z=w*a.z+u*b.z+v*c.z;
            const int pixel=y*rasterWidth+x;
            if(z<=depthBuffer[pixel]) continue;
            depthBuffer[pixel]=(float)z;
            const Vec rgb=a.rgb*w+b.rgb*u+c.rgb*v;
            auto encode=[](double value) { return transfer[std::clamp((int)(value*4095),0,4095)]; };
            samples[3*pixel]=encode(rgb.x);
            samples[3*pixel+1]=encode(rgb.y);
            samples[3*pixel+2]=encode(rgb.z);
        }
    }
}
void render(int frame) {
    const double phase=.96+tau*(frame%frames)/frames;
    const View view{.13+.075*std::sin(phase), -.23+.04*std::cos(phase), -.072+.018*std::sin(phase)};
    const Surface material{unit({-.44+.18*std::sin(phase),.66,.73}),unit({.86,-.26+.13*std::cos(phase),.38})};
    std::fill(samples.begin(),samples.end(),0);
    std::fill(depthBuffer.begin(),depthBuffer.end(),-std::numeric_limits<float>::infinity());
    using Ring=std::array<Vertex,bevelSteps>;
    for(int strand=0;strand<strips;++strand) {
        Ring previous;
        const double band=strand-(strips-1)*.5;
        for(int section=0;section<=sections;++section) {
            const double t=tau*(section%sections)/sections, s=std::sin(t), c=std::cos(t);
            // Two broad loops, one deliberately raised crossing, seven individually milled contours.
            const Vec center{2.68*s,1.13*std::sin(2*t),.60*c+.09*std::sin(2*t)};
            const Vec tangent=unit({2.68*c,2.26*std::cos(2*t),-.60*s+.18*std::cos(2*t)});
            const Vec left=unit(cross({0,0,1},tangent)), up=cross(tangent,left);
            const double twist=.45+.75*std::sin(t+.52)+.22*std::cos(2*t);
            const Vec side=left*std::cos(twist)+up*std::sin(twist);
            const Vec normal=up*std::cos(twist)-left*std::sin(twist);
            const double spacing=.099*(1+.14*std::sin(2*t+.3));
            const Vec spine=center+side*(band*spacing)+normal*(.075-.009*band*band);
            Ring current;
            for(int j=0;j<bevelSteps;++j) {
                const double angle=tau*j/bevelSteps, h=std::cos(angle), v=std::sin(angle);
                const Vec p=view.transform(spine+side*(.040*h)+normal*(.068*v));
                const Vec n=view.transform(side*(h/.040)+normal*(v/.068));
                const double scale=176.0*sampling*(9.6/(9.6-p.z));
                current[j]={rasterWidth*.5+p.x*scale,rasterHeight*.49-p.y*scale,p.z,material.color(n,t,band,p.z)};
            }
            if(section) for(int j=0;j<bevelSteps;++j) {
                const int next=(j+1)%bevelSteps;
                triangle(previous[j],current[j],current[next]);
                triangle(previous[j],current[next],previous[next]);
            }
            previous=current;
        }
    }
    for(int y=0;y<height;++y) for(int x=0;x<width;++x) {
        int src=(y*2*rasterWidth+x*2)*3, dst=(y*width+x)*3;
        for(int channel=0;channel<3;++channel,++src)
            output[dst+channel]=(samples[src]+samples[src+3]+samples[src+rasterWidth*3]+samples[src+rasterWidth*3+3]+2)/4;
    }
    if(std::fwrite(output.data(),1,output.size(),stdout)!=output.size()) std::exit(1);
}
} // namespace
int main(int argc,char** argv) {
    for(size_t i=0;i<transfer.size();++i) {
        const double linear=i/4095.0;
        const double srgb=linear<=.0031308 ? 12.92*linear : 1.055*std::pow(linear,1/2.4)-.055;
        transfer[i]=(unsigned char)std::round(srgb*255.0);
    }
    if(argc>1) render(std::atoi(argv[1])); else for(int frame=0;frame<frames;++frame) render(frame);
}
