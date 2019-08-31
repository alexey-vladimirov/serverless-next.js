const nextBuild = require("next/dist/build").default;
const path = require("path");
const fse = require("fs-extra");
const NextjsComponent = require("../serverless");

jest.mock("next/dist/build");

const mockBackend = jest.fn();
jest.mock("@serverless/backend", () =>
  jest.fn(() => {
    const backend = mockBackend;
    backend.init = () => {};
    backend.default = () => {};
    backend.context = {};
    return backend;
  })
);

const mockS3Upload = jest.fn();
const mockS3 = jest.fn();
jest.mock("@serverless/aws-s3", () =>
  jest.fn(() => {
    const bucket = mockS3;
    bucket.init = () => {};
    bucket.default = () => {};
    bucket.context = {};
    bucket.upload = mockS3Upload;
    return bucket;
  })
);

const mockCloudFront = jest.fn();
jest.mock("@serverless/aws-cloudfront", () =>
  jest.fn(() => {
    const cloudFront = mockCloudFront;
    cloudFront.init = () => {};
    cloudFront.default = () => {};
    cloudFront.context = {};
    return cloudFront;
  })
);

const BUILD_DIR = "serverless-nextjs-tmp";

describe("build tests", () => {
  let tmpCwd;
  let manifest;

  const fixturePath = path.join(__dirname, "./fixtures/simple-app");

  beforeEach(async () => {
    nextBuild.mockResolvedValueOnce();

    tmpCwd = process.cwd();
    process.chdir(fixturePath);

    mockBackend.mockResolvedValueOnce({
      url: "https://ssr-api-xyz.execute-api.us-east-1.amazonaws.com/production"
    });
    mockS3.mockResolvedValue({
      name: "bucket-xyz"
    });

    const component = new NextjsComponent();
    await component.default();

    manifest = await fse.readJSON(
      path.join(fixturePath, `${BUILD_DIR}/manifest.json`)
    );
  });

  afterEach(() => {
    process.chdir(tmpCwd);
  });

  describe("manifest", () => {
    it("adds ssr page route", async () => {
      const {
        pages: {
          ssr: { nonDynamic }
        }
      } = manifest;

      expect(nonDynamic["/customers/new"]).toEqual("pages/customers/new.js");
    });

    it("adds ssr dynamic page route to express equivalent", async () => {
      const {
        pages: {
          ssr: { dynamic }
        }
      } = manifest;

      expect(dynamic["/blog/:id"]).toEqual({
        file: "pages/blog/[id].js",
        regex: "^\\/blog\\/([^\\/]+?)(?:\\/)?$"
      });
    });

    it("adds dynamic page with multiple segments to express equivalent", async () => {
      const {
        pages: {
          ssr: { dynamic }
        }
      } = manifest;

      expect(dynamic["/customers/:customer/:post"]).toEqual({
        file: "pages/customers/[customer]/[post].js",
        regex: "^\\/customers\\/([^\\/]+?)\\/([^\\/]+?)(?:\\/)?$"
      });
    });

    it("adds static page route", async () => {
      const {
        pages: { html }
      } = manifest;

      expect(html["/terms"]).toEqual("pages/terms.html");
    });

    it("adds public files", async () => {
      const { publicFiles } = manifest;

      expect(publicFiles).toEqual({
        "/favicon.ico": "favicon.ico",
        "/sw.js": "sw.js"
      });
    });

    it("adds the full manifest", async () => {
      const {
        pages: {
          ssr: { dynamic, nonDynamic },
          html
        }
      } = manifest;

      expect(dynamic).toEqual({
        "/:root": {
          file: "pages/[root].js",
          regex: expect.any(String)
        },
        "/blog/:id": {
          file: "pages/blog/[id].js",
          regex: expect.any(String)
        },
        "/customers/:customer": {
          file: "pages/customers/[customer].js",
          regex: expect.any(String)
        },
        "/customers/:customer/:post": {
          file: "pages/customers/[customer]/[post].js",
          regex: expect.any(String)
        },
        "/customers/:customer/profile": {
          file: "pages/customers/[customer]/profile.js",
          regex: expect.any(String)
        }
      });

      expect(nonDynamic).toEqual({
        "/customers/new": "pages/customers/new.js",
        "/": "pages/index.js",
        "/_app": "pages/_app.js",
        "/_document": "pages/_document.js",
        "/404": "pages/404.js"
      });

      expect(html).toEqual({
        "/terms": "pages/terms.html"
      });
    });

    it.skip("adds ssr api domain", () => {
      const {
        cloudFrontOrigins: { ssrApi }
      } = manifest;

      expect(mockBackend).toBeCalledWith({
        code: {
          src: `./${BUILD_DIR}`
        }
      });

      expect(ssrApi).toEqual({
        domainName: "ssr-api-xyz.execute-api.us-east-1.amazonaws.com"
      });
    });
  });

  describe("build files", () => {
    it("copies nextjs pages to build folder", async () => {
      const pagesRootFiles = await fse.readdir(
        path.join(fixturePath, `${BUILD_DIR}/pages`)
      );
      const pagesCustomersFiles = await fse.readdir(
        path.join(fixturePath, `${BUILD_DIR}/pages/customers`)
      );

      expect(pagesRootFiles).toContain("blog.js");
      expect(pagesCustomersFiles).toEqual(["[post].js"]);
    });

    it("copies lambda handler to build folder", async () => {
      const buildDirRoot = await fse.readdir(
        path.join(fixturePath, `${BUILD_DIR}`)
      );

      expect(buildDirRoot).toContain("index.js");
    });

    it("copies router to build folder", async () => {
      const buildDirRoot = await fse.readdir(
        path.join(fixturePath, `${BUILD_DIR}`)
      );

      expect(buildDirRoot).toContain("router.js");
    });

    it("copies compat layer to node_modules", async () => {
      const nodeModules = await fse.readdir(
        path.join(fixturePath, `${BUILD_DIR}/node_modules`)
      );

      expect(nodeModules).toEqual(["next-aws-lambda"]);
    });
  });

  describe("assets bucket", () => {
    it("uploads client build assets", () => {
      expect(mockS3Upload).toBeCalledWith({
        dir: "./.next/static",
        keyPrefix: "_next/static"
      });
    });

    it("uploads user static directory", () => {
      expect(mockS3Upload).toBeCalledWith({
        dir: "./static",
        keyPrefix: "static"
      });
    });

    it("uploads user public directory", () => {
      expect(mockS3Upload).toBeCalledWith({
        dir: "./public",
        keyPrefix: "public"
      });
    });
  });

  describe("cloudfront", () => {
    it("creates distribution with appropiate cache behaviours", () => {
      expect(mockCloudFront).toBeCalledWith({
        ttl: 5,
        origins: [
          "https://ssr-api-xyz.execute-api.us-east-1.amazonaws.com/production",
          {
            url: "http://bucket-xyz.s3.amazonaws.com",
            private: true,
            pathPatterns: {
              "_next/*": {
                ttl: 86400
              },
              "static/*": {
                ttl: 86400
              }
            }
          }
        ]
      });
    });
  });
});