#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <Vision/Vision.h>

static NSString *recognizePage(PDFPage *page, NSString **warning) {
    CGRect bounds = [page boundsForBox:kPDFDisplayBoxCropBox];
    if (bounds.size.width <= 0 || bounds.size.height <= 0) return @"";
    const CGFloat scale = fmin(1700.0 / bounds.size.width, 2200.0 / bounds.size.height);
    const size_t width = (size_t) fmax(1, round(bounds.size.width * scale));
    const size_t height = (size_t) fmax(1, round(bounds.size.height * scale));
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4, colorSpace, kCGImageAlphaNoneSkipLast);
    CGColorSpaceRelease(colorSpace);
    if (!context) return @"";
    CGContextSetRGBFillColor(context, 1, 1, 1, 1);
    CGContextFillRect(context, CGRectMake(0, 0, width, height));
    CGContextScaleCTM(context, scale, scale);
    CGContextTranslateCTM(context, -bounds.origin.x, -bounds.origin.y);
    [page drawWithBox:kPDFDisplayBoxCropBox toContext:context];
    CGImageRef image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    if (!image) return @"";

    VNRecognizeTextRequest *revision = [VNRecognizeTextRequest new];
    revision.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    revision.recognitionLanguages = @[@"es-ES", @"en-US"];
    revision.usesLanguageCorrection = YES;
    // The local service also runs on Macs without a usable GPU or Neural Engine.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    revision.usesCPUOnly = YES;
#pragma clang diagnostic pop
    VNImageRequestHandler *reader = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    CGImageRelease(image);
    NSError *error = nil;
    if (![reader performRequests:@[revision] error:&error]) {
        if (warning) *warning = [NSString stringWithFormat:@"Vision %@ (%ld)", error.domain ?: @"OCR", (long) error.code];
        return @"";
    }
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *line in revision.results) {
        NSString *text = [line topCandidates:1].firstObject.string;
        if (text.length) [lines addObject:text];
    }
    return [lines componentsJoinedByString:@"\n"];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 5) return 1;
        NSInteger first = [@(argv[2]) integerValue];
        NSInteger last = [@(argv[3]) integerValue];
        if (first < 1 || last < first) return 1;
        BOOL runOCR = strcmp(argv[4], "1") == 0;
        NSURL *file = [NSURL fileURLWithPath:@(argv[1])];
        PDFDocument *document = [[PDFDocument alloc] initWithURL:file];
        NSInteger total = document.pageCount;
        NSMutableArray *pages = [NSMutableArray array];
        NSMutableArray *warnings = [NSMutableArray array];
        if (document && !document.isLocked) {
            for (NSInteger index = first - 1; index < MIN(total, last); index++) {
                @autoreleasepool {
                    PDFPage *page = [document pageAtIndex:index];
                    NSString *text = [page.string stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] ?: @"";
                    BOOL recognized = NO;
                    if (runOCR && text.length < 45 && page) {
                        NSString *warning = nil;
                        NSString *scan = recognizePage(page, &warning);
                        if (scan.length > text.length) {
                            text = scan;
                            recognized = YES;
                        }
                        if (warning) [warnings addObject:[NSString stringWithFormat:@"Página %ld · %@", (long) (index + 1), warning]];
                    }
                    [pages addObject:@{@"page": @(index + 1), @"text": text, @"ocr": @(recognized)}];
                }
            }
        }
        NSMutableDictionary *result = [@{@"pages": pages, @"total": @(total), @"warnings": warnings} mutableCopy];
        if (!document) result[@"status"] = @"invalid";
        else if (document.isLocked) result[@"status"] = @"locked";
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
        if (!json) return 2;
        [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
        return 0;
    }
}
