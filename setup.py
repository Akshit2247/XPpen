from setuptools import setup, find_packages

setup(
    name="xppen",
    version="1.0.0",
    packages=find_packages(),
    entry_points={
        "console_scripts": [
            "xppen=xppen.cli:main",
        ],
    },
)
