

from rag_index import build_index

if __name__ == "__main__":
    # Force rebuild every time you run this script
    # Change to False if you want to skip rebuild when index exists
    build_index(force_rebuild=True)